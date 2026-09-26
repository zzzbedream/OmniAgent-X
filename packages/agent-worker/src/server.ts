import { ASSIGN_OPERATOR_TYPES, FACTORY_EIP712_DOMAIN, PERPL_TESTNET, delegatedAccountFactoryAbi } from "@omniagent/core";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import type { WorkerConfig } from "./config";
import { checkAccountOnChain, executeClose, executePlan } from "./executor";
import { DecisionLog, jsonReplacer } from "./log";
import { KeyedMutex, RateLimiter } from "./rateLimit";
import { ValidationError, validateClose, validateConsentRequest, validateSubmission } from "./validate";

const MAX_BODY_BYTES = 64 * 1024;

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

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<[number, unknown]>> = {
    "GET /health": async () => [200, { ok: true, operator: operator.address, executionEnabled: cfg.executionEnabled }],

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
  };

  return createServer(async (req, res) => {
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
      send(res, 500, { error: "internal error", message: (e as Error).message.slice(0, 300) });
    }
  });
}
