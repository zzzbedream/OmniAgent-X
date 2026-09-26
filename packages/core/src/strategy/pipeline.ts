// Intent → plan pipeline: Kimi parses the request, Qwen sizes the plan, the risk policy decides.
import type { MarketSymbol } from "../perpl/network";
import { type LlmConfig, type LlmResult, chatJson } from "./llm";
import { DEFAULT_TESTNET_POLICY, type RiskPolicy, type RiskReport, evaluatePlan } from "./risk";
import { type IntentParams, IntentParamsSchema, type TradePlan, TradePlanSchema } from "./schema";

export type MarketQuote = { market: MarketSymbol; markPriceUsd: number; fundingRatePct: number | null };

export const INTENT_SYSTEM = `You convert a user's trading request into structured parameters. Output ONLY a JSON object:
{"budgetUsd": number|null, "markets": ["BTC"|"ETH"|"SOL"|"MON"], "bias": [{"market": ..., "direction": "long"|"short"|"hedge"|"neutral"}],
 "riskAppetite": "low"|"medium"|"high", "conditions": [string], "unsupported": [string]}
Rules: never invent numbers the user did not give (budgetUsd null if absent). Only perpetual futures on BTC, ETH, SOL, MON exist.
List anything the user asked for that these markets cannot do (e.g. spot altcoin buys, other assets) in "unsupported".`;

export function planSystem(policy: RiskPolicy): string {
  return `You size a perpetual-futures plan on Perpl (Monad testnet). Output ONLY a JSON object:
{"orders": [{"market": "BTC"|"ETH"|"SOL"|"MON", "side": "long"|"short", "notionalUsd": number, "leverage": number}],
 "summary": string (<= 600 chars), "riskNotes": string (<= 600 chars)}
Hard limits (a plan breaking any of them is rejected whole): markets ${policy.allowedMarkets.join(",")};
leverage 1..${policy.maxLeverage}; at most ${policy.maxOrders} orders; one order per market;
notional per order ${policy.minOrderNotionalUsd}..${policy.maxOrderNotionalUsd} USD;
sum of notionalUsd/leverage <= budget. Keep part of the budget unallocated as a buffer.
Use only the prices given; do not assume other data. An empty "orders" list is a valid answer if nothing fits.`;
}

export type PlanOutcome = {
  intent: LlmResult<IntentParams>;
  plan: LlmResult<TradePlan>;
  risk: RiskReport;
  budgetUsd: number;
};

export async function runPlanningPipeline(args: {
  request: string;
  budgetUsd: number;
  quotes: MarketQuote[];
  kimi: LlmConfig;
  qwen: LlmConfig;
  policy?: RiskPolicy;
  fetchImpl?: typeof fetch;
}): Promise<PlanOutcome> {
  const policy = args.policy ?? DEFAULT_TESTNET_POLICY;
  const intent = await chatJson(args.kimi, IntentParamsSchema, INTENT_SYSTEM, args.request, args.fetchImpl);
  // The UI budget is authoritative; a budget typed in the free text is only informative.
  const budgetUsd = args.budgetUsd;
  const planUser = JSON.stringify({
    budgetUsd,
    userRequest: args.request,
    parsedIntent: intent.data,
    markets: args.quotes,
  });
  const plan = await chatJson(args.qwen, TradePlanSchema, planSystem(policy), planUser, args.fetchImpl);
  return { intent, plan, risk: evaluatePlan(plan.data, budgetUsd, policy), budgetUsd };
}
