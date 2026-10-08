import {
  ASSIGN_OPERATOR_TYPES,
  FACTORY_EIP712_DOMAIN,
  PERPL_TESTNET,
  delegatedAccountFactoryAbi,
  describeMandate,
} from "@omniagent/core";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import type { WorkerConfig } from "./config";
import { checkAccountAccess, checkAccountOnChain, executeClose, executeGuardianAction, executePlan } from "./executor";
import { GuardianLoop, GuardianStore } from "./guardian";
import { makePositionReader } from "./guardianChain";
import { DecisionLog, jsonReplacer, safeErrorMessage } from "./log";
import { KeyedMutex, RateLimiter } from "./rateLimit";
import {
  ValidationError,
  validateClose,
  validateConsentRequest,
  validateMandateSubmission,
  validateRevoke,
  validateSubmission,
} from "./validate";

const MAX_BODY_BYTES = 64 * 1024;
/** Bounds the guardian's per-tick work (security review M5). */
const MAX_ACTIVE_MANDATES = 200;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ValidationError("body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

class RateLimited extends Error {}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  const fwd = req.headers["x-forwarded-for"];
  if (trustProxy && typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, jsonReplacer));
}

export function createWorker(cfg: WorkerConfig) {
  const operator = privateKeyToAccount(cfg.operatorPk);
  const client = createPublicClient({ chain: monadTestnet, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account: operator, chain: monadTestnet, transport: http(cfg.rpcUrl) });
  const log = new DecisionLog(cfg.dataDir);
  const limiter = new RateLimiter(cfg.rateLimitPerMin);
  const perAccount = new KeyedMutex();
  const mode = cfg.executionEnabled ? ("live" as const) : ("dry-run" as const);
  const guardianStore = new GuardianStore(cfg.dataDir);
  const guardianLoop = new GuardianLoop({
    store: guardianStore,
    log,
    mode,
    addCollateralEnabled: cfg.guardianAddCollateral,
    readPositions: makePositionReader({
      client,
      log,
      sides: guardianStore,
      mode,
      perplApiUrl: cfg.perplApiUrl,
      indexerUrl: cfg.indexerUrl,
    }),
    execute: async (rec, action, position) => {
      // The engine never acts on an unknown side; this guards the executor against a future engine bug.
      if (position.side === "unknown") return { status: "failed", error: "position side unknown" };
      return executeGuardianAction({
        client,
        wallet,
        owner: rec.owner,
        account: rec.account,
        action,
        side: position.side,
        slippageBps: cfg.slippageBps,
        live: cfg.executionEnabled,
      });
    },
    withLock: (account, fn) => perAccount.run(account, fn),
    now: () => Math.floor(Date.now() / 1000),
  });
  const guardianInfo = { intervalMs: cfg.guardianIntervalMs, addCollateralEnabled: cfg.guardianAddCollateral };

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<[number, unknown]>> = {
    "GET /health": async () => [
      200,
      { ok: true, operator: operator.address, executionEnabled: cfg.executionEnabled, guardian: guardianInfo },
    ],

    "GET /operator": async () => [200, { operator: operator.address, chainId: PERPL_TESTNET.chainId }],

    // Operator consent (EIP-712 AssignOperator on the factory domain) so the owner can call factory.create.
    // The caller must prove it controls `owner` (ConsentRequest signature) before the operator signs anything.
    "POST /operator/consent": async req => {
      const owner = await validateConsentRequest(await readJson(req), { chainId: PERPL_TESTNET.chainId, nowSec: nowSec() });
      const nonce = await client.readContract({
        address: PERPL_TESTNET.factory,
        abi: delegatedAccountFactoryAbi,
        functionName: "operatorNonces",
        args: [operator.address],
      });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const signature = await operator.signTypedData({
        domain: FACTORY_EIP712_DOMAIN,
        types: ASSIGN_OPERATOR_TYPES,
        primaryType: "AssignOperator",
        message: { owner, nonce, deadline },
      });
      return [200, { operator: operator.address, owner, nonce, deadline, signature }];
    },

    "POST /plans": async req => {
      const validated = await validateSubmission(await readJson(req), {
        chainId: PERPL_TESTNET.chainId,
        nowSec: nowSec(),
        isNonceUsed: (owner, nonce) => log.isNonceUsed(owner, nonce),
      });
      const base = {
        ts: new Date().toISOString(),
        kind: "plan" as const,
        owner: validated.message.owner,
        account: validated.message.account,
        nonce: validated.message.nonce.toString(),
        planHash: validated.message.planHash,
        mode,
      };
      return perAccount.run(validated.message.account, async (): Promise<[number, unknown]> => {
        // Re-check inside the per-account lock: two identical submissions both pass validation above.
        if (!log.reserve(base)) throw new ValidationError("approval nonce already used");
        try {
          await checkAccountOnChain(client, validated, operator.address);
        } catch (e) {
          log.append({ ...base, status: "rejected", detail: (e as Error).message });
          throw e;
        }
        const result = await executePlan({
          client,
          wallet,
          plan: validated,
          slippageBps: cfg.slippageBps,
          live: cfg.executionEnabled,
        });
        log.append({ ...base, status: result.status, detail: result.orders });
        return [200, { ...result, risk: validated.risk }];
      });
    },

    "POST /close": async req => {
      const close = await validateClose(await readJson(req), {
        chainId: PERPL_TESTNET.chainId,
        nowSec: nowSec(),
        isNonceUsed: (owner, nonce) => log.isNonceUsed(owner, nonce),
      });
      const base = {
        ts: new Date().toISOString(),
        kind: "close" as const,
        owner: close.message.owner,
        account: close.message.account,
        nonce: close.message.nonce.toString(),
        planHash: `close:${close.message.perpId}`,
        mode,
      };
      return perAccount.run(close.message.account, async (): Promise<[number, unknown]> => {
        if (!log.reserve(base)) throw new ValidationError("approval nonce already used");
        try {
          const result = await executeClose({
            client,
            wallet,
            close,
            slippageBps: cfg.slippageBps,
            live: cfg.executionEnabled,
            sideFromLog: (account, perpId) => log.sideForMarket(account, perpId, mode),
            indexerUrl: cfg.indexerUrl,
          });
          log.append({ ...base, status: result.status, detail: { perpId: close.message.perpId, ...result } });
          return [200, result];
        } catch (e) {
          log.append({ ...base, status: "rejected", detail: { perpId: close.message.perpId, error: (e as Error).message } });
          throw e;
        }
      });
    },

    "GET /decisions": async (_req, url) => [200, { entries: log.recent(url.searchParams.get("account") ?? undefined) }],

    // Owner-signed guardian mandate. One per account; a new one replaces the old.
    "POST /guardian/mandates": async req => {
      const v = await validateMandateSubmission(await readJson(req), {
        chainId: PERPL_TESTNET.chainId,
        nowSec: nowSec(),
        isNonceUsed: (owner, nonce) => log.isNonceUsed(owner, nonce),
      });
      const { owner, account, nonce, expiresAt } = v.message;
      const base = {
        ts: new Date().toISOString(),
        kind: "mandate" as const,
        owner,
        account,
        nonce: nonce.toString(),
        planHash: v.mandateHash,
        mode,
      };
      return perAccount.run(account, async (): Promise<[number, unknown]> => {
        if (!log.reserve(base)) throw new ValidationError("mandate nonce already used");
        try {
          await checkAccountAccess(client, owner, account, operator.address);
        } catch (e) {
          log.append({ ...base, status: "rejected", detail: safeErrorMessage(e) });
          throw e;
        }
        const now = Number(nowSec());
        if (!guardianStore.get(account) && guardianStore.active(now).length >= MAX_ACTIVE_MANDATES) {
          throw new ValidationError("the guardian is at capacity; try again later");
        }
        guardianStore.activate(
          {
            owner,
            account,
            mandate: v.mandate,
            mandateHash: v.mandateHash,
            nonce: base.nonce,
            expiresAt: Number(expiresAt),
            activatedAt: now,
            mode,
          },
          now,
        );
        const lines = describeMandate(v.mandate);
        log.append({ ...base, status: "active", detail: { lines, expiresAt: expiresAt.toString() } });
        return [200, { active: true, mandateHash: v.mandateHash, expiresAt: expiresAt.toString(), lines, mode, guardian: guardianInfo }];
      });
    },

    "POST /guardian/revoke": async req => {
      const { message } = await validateRevoke(await readJson(req), {
        chainId: PERPL_TESTNET.chainId,
        nowSec: nowSec(),
        isNonceUsed: (owner, nonce) => log.isNonceUsed(owner, nonce),
      });
      return perAccount.run(message.account, async (): Promise<[number, unknown]> => {
        const rec = guardianStore.get(message.account);
        if (!rec || getAddress(rec.owner) !== message.owner) {
          throw new ValidationError("no active mandate for this owner and account");
        }
        const base = {
          ts: new Date().toISOString(),
          kind: "revoke" as const,
          owner: message.owner,
          account: message.account,
          nonce: message.nonce.toString(),
          planHash: rec.mandateHash,
          mode,
        };
        if (!log.reserve(base)) throw new ValidationError("revocation nonce already used");
        guardianStore.revoke(message.account);
        log.append({ ...base, status: "revoked" });
        return [200, { active: false }];
      });
    },

    "GET /guardian/status": async (_req, url) => {
      const account = url.searchParams.get("account");
      if (!account || !isAddress(account)) throw new ValidationError("account must be an address");
      const now = Number(nowSec());
      const rec = guardianStore.get(account);
      if (!rec || rec.expiresAt <= now) return [200, { active: false, mode, guardian: guardianInfo }];
      return [
        200,
        {
          active: true,
          mode,
          guardian: guardianInfo,
          mandate: rec.mandate,
          mandateHash: rec.mandateHash,
          lines: describeMandate(rec.mandate),
          expiresAt: rec.expiresAt,
          activatedAt: rec.activatedAt,
          state: guardianStore.stateFor(account, now),
          lastTick: guardianLoop.status(account),
        },
      ];
    },
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://worker");
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: "not found" });
    try {
      if (req.method === "POST" && !limiter.take(clientKey(req, cfg.trustProxy))) throw new RateLimited();
      const [status, body] = await handler(req, url);
      send(res, status, body);
    } catch (e) {
      if (e instanceof RateLimited) return send(res, 429, { error: "rate limited" });
      if (e instanceof ValidationError) return send(res, 400, { error: e.message, details: e.details });
      console.error(e);
      send(res, 500, { error: "internal error", message: safeErrorMessage(e) });
    }
  });
  guardianLoop.start(cfg.guardianIntervalMs);
  server.on("close", () => guardianLoop.stop());
  return server;
}
