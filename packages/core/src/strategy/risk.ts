// Deterministic risk policy. The LLM proposes; this decides.
// A plan that violates any rule is REJECTED as a whole — it is never silently clamped, because
// clamping would execute something neither the model nor the user actually proposed.
import type { MarketSymbol } from "../perpl/network";
import type { TradePlan } from "./schema";

export type RiskPolicy = {
  allowedMarkets: readonly MarketSymbol[];
  maxLeverage: number;
  maxOrders: number;
  /** Largest single position notional, in USD. */
  maxOrderNotionalUsd: number;
  /** Smallest single position notional, in USD (below this the order is noise or below one lot). */
  minOrderNotionalUsd: number;
};

export const DEFAULT_TESTNET_POLICY: RiskPolicy = {
  allowedMarkets: ["BTC", "ETH", "SOL", "MON"],
  maxLeverage: 3,
  maxOrders: 4,
  maxOrderNotionalUsd: 3000,
  minOrderNotionalUsd: 5,
};

export type RiskViolation = { rule: string; detail: string };

export type RiskReport = {
  ok: boolean;
  violations: RiskViolation[];
  /** Sum over orders of notional / leverage: the collateral the plan would lock, in USD. */
  requiredMarginUsd: number;
  totalNotionalUsd: number;
};

/**
 * @param budgetUsd collateral the user allocated to the agent; total required margin must fit in it.
 */
export function evaluatePlan(plan: TradePlan, budgetUsd: number, policy: RiskPolicy = DEFAULT_TESTNET_POLICY): RiskReport {
  const violations: RiskViolation[] = [];
  if (!(budgetUsd > 0)) violations.push({ rule: "budget", detail: `budget must be positive, got ${budgetUsd}` });
  if (plan.orders.length === 0) violations.push({ rule: "orders", detail: "plan has no orders" });
  if (plan.orders.length > policy.maxOrders) {
    violations.push({ rule: "maxOrders", detail: `${plan.orders.length} orders > ${policy.maxOrders}` });
  }

  const seen = new Set<string>();
  let requiredMarginUsd = 0;
  let totalNotionalUsd = 0;
  plan.orders.forEach((o, i) => {
    const tag = `order[${i}] ${o.side} ${o.market}`;
    if (!policy.allowedMarkets.includes(o.market)) violations.push({ rule: "market", detail: `${tag}: market not allowed` });
    if (o.leverage > policy.maxLeverage) {
      violations.push({ rule: "maxLeverage", detail: `${tag}: ${o.leverage}x > ${policy.maxLeverage}x` });
    }
    if (o.notionalUsd > policy.maxOrderNotionalUsd) {
      violations.push({ rule: "maxOrderNotional", detail: `${tag}: ${o.notionalUsd} > ${policy.maxOrderNotionalUsd} USD` });
    }
    if (o.notionalUsd < policy.minOrderNotionalUsd) {
      violations.push({ rule: "minOrderNotional", detail: `${tag}: ${o.notionalUsd} < ${policy.minOrderNotionalUsd} USD` });
    }
    // Perpl positions are per market and account; two orders on one market would net or conflict.
    if (seen.has(o.market)) violations.push({ rule: "duplicateMarket", detail: `${tag}: market already used in plan` });
    seen.add(o.market);
    requiredMarginUsd += o.notionalUsd / o.leverage;
    totalNotionalUsd += o.notionalUsd;
  });

  if (requiredMarginUsd > budgetUsd + 1e-9) {
    violations.push({
      rule: "budget",
      detail: `required margin ${requiredMarginUsd.toFixed(2)} > budget ${budgetUsd.toFixed(2)} USD`,
    });
  }
  return { ok: violations.length === 0, violations, requiredMarginUsd, totalNotionalUsd };
}
