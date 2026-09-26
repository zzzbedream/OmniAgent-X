// POST /api/strategy — natural-language intent → Kimi (parse) → Qwen (plan) → risk policy.
// Server-only: API keys never reach the browser. Nothing here executes trades; the user must sign
// the resulting plan and the worker re-validates it.
//
// Every accepted request costs two paid LLM calls, so before spending anything the caller must:
//  1. sign PlanRequest (bound to this exact text + budget, 5-min expiry) with the Mera owner key, and
//  2. own an on-chain DelegatedAccount with an exchange account (costs gas + the minimum deposit) and,
//     when WORKER_OPERATOR_ADDRESS is set, with our worker as operator.
// Quotas are per owner and global, in memory and per process: they do not survive restarts nor span
// serverless instances (a shared store would be needed for that; out of MVP scope).
import { NextResponse } from "next/server";
import {
  DailyQuota,
  LlmError,
  MARKET_SYMBOLS,
  type MarketQuote,
  PERPL_TESTNET,
  RequestAuthError,
  hashPlanOrders,
  llmConfigFromEnv,
  readDelegatedAccount,
  readPerpSnapshot,
  runPlanningPipeline,
  verifyPlanRequest,
} from "@omniagent/core";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { monadTestnet } from "viem/chains";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  request: z.string().trim().min(5).max(1000),
  budgetUsd: z.number().positive().max(100_000),
  auth: z.unknown(),
});

const quota = new DailyQuota();
const expectedOperator =
  process.env.WORKER_OPERATOR_ADDRESS && isAddress(process.env.WORKER_OPERATOR_ADDRESS)
    ? getAddress(process.env.WORKER_OPERATOR_ADDRESS)
    : undefined;

const client = createPublicClient({ chain: monadTestnet, transport: http(process.env.MONAD_TESTNET_RPC || undefined) });

async function readQuotes(): Promise<MarketQuote[]> {
  return Promise.all(
    MARKET_SYMBOLS.map(async market => {
      const perp = await readPerpSnapshot(client, market);
      return {
        market,
        markPriceUsd: Number(perp.markPNS) / 10 ** Number(perp.priceDecimals),
        // fundingRatePct100k units are not verified yet; do not feed a possibly wrong number to the model.
        fundingRatePct: null,
      };
    }),
  );
}

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid body", details: parsed.error.issues }, { status: 400 });

  const kimi = llmConfigFromEnv("KIMI", process.env);
  const qwen = llmConfigFromEnv("QWEN", process.env);
  const missing = [
    !kimi && "KIMI_BASE_URL/KIMI_API_KEY/KIMI_MODEL",
    !qwen && "QWEN_BASE_URL/QWEN_API_KEY/QWEN_MODEL",
  ].filter(Boolean);
  if (!kimi || !qwen) return NextResponse.json({ error: "LLM not configured", missing }, { status: 503 });

  let caller: Awaited<ReturnType<typeof verifyPlanRequest>>;
  try {
    caller = await verifyPlanRequest(parsed.data.auth, parsed.data.request, parsed.data.budgetUsd, {
      chainId: PERPL_TESTNET.chainId,
      nowSec: BigInt(Math.floor(Date.now() / 1000)),
    });
  } catch (e) {
    if (e instanceof RequestAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  try {
    const acc = await readDelegatedAccount(client, caller.account, expectedOperator);
    if (acc.owner !== caller.owner) throw new Error("signer does not own this DelegatedAccount");
    if (acc.accountId === 0n) throw new Error("DelegatedAccount has no exchange account (deposit first)");
    if (expectedOperator && !acc.isOperator) throw new Error("this app's agent is not an operator of the account");
  } catch (e) {
    return NextResponse.json({ error: "account not eligible", message: (e as Error).message }, { status: 403 });
  }

  let quotes: MarketQuote[];
  try {
    quotes = await readQuotes();
  } catch (e) {
    return NextResponse.json(
      { error: "could not read Perpl market data", message: (e as Error).message },
      { status: 502 },
    );
  }

  // Charged only once market data is in hand, right before the two paid LLM calls.
  if (!quota.take(`owner:${caller.owner}`, Number(process.env.LLM_MAX_PLANS_PER_OWNER_PER_DAY ?? 10))) {
    return NextResponse.json({ error: "daily planning quota for this account exhausted" }, { status: 429 });
  }
  if (!quota.take("global", Number(process.env.LLM_MAX_PLANS_PER_DAY ?? 50))) {
    return NextResponse.json({ error: "daily planning quota exhausted" }, { status: 429 });
  }

  try {
    const out = await runPlanningPipeline({
      request: parsed.data.request,
      budgetUsd: parsed.data.budgetUsd,
      quotes,
      kimi,
      qwen,
    });
    return NextResponse.json({
      budgetUsd: out.budgetUsd,
      quotes,
      intent: out.intent.data,
      plan: out.plan.data,
      planHash: hashPlanOrders(out.plan.data),
      risk: out.risk,
      telemetry: {
        kimi: { model: out.intent.model, latencyMs: out.intent.latencyMs, usage: out.intent.usage },
        qwen: { model: out.plan.model, latencyMs: out.plan.latencyMs, usage: out.plan.usage },
      },
    });
  } catch (e) {
    if (e instanceof LlmError) {
      return NextResponse.json({ error: `${e.provider}: ${e.message}`, raw: e.raw?.slice(0, 2000) }, { status: 502 });
    }
    throw e;
  }
}
