// POST /api/strategy — natural-language intent → Kimi (parse) → Qwen (plan) → risk policy.
// Server-only: API keys never reach the browser. Nothing here executes trades; the user must sign
// the resulting plan and the worker re-validates it.
import { NextResponse } from "next/server";
import {
  LlmError,
  MARKET_SYMBOLS,
  type MarketQuote,
  hashPlanOrders,
  llmConfigFromEnv,
  readPerpSnapshot,
  runPlanningPipeline,
} from "@omniagent/core";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  request: z.string().trim().min(5).max(1000),
  budgetUsd: z.number().positive().max(100_000),
});

// Per-process daily cap. It resets on restart and is not shared across instances: a guard against
// runaway spend during the hackathon, not a billing control.
const counter = { day: "", count: 0 };
function takeQuota(limit: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (counter.day !== day) Object.assign(counter, { day, count: 0 });
  if (counter.count >= limit) return false;
  counter.count++;
  return true;
}

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
  if (!takeQuota(Number(process.env.LLM_MAX_PLANS_PER_DAY ?? 50))) {
    return NextResponse.json({ error: "daily planning quota exhausted" }, { status: 429 });
  }

  try {
    const out = await runPlanningPipeline({ ...parsed.data, quotes, kimi, qwen });
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
