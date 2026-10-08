// Deterministic guardian: given a signed mandate and the current positions, decide at most one
// protective action per position. Pure: no I/O, no clock, no model. The worker and the in-browser
// shock simulation run the same function.
//
// Choice: among the rules whose trigger is breached, the most severe action wins (close > larger
// reduce > smaller reduce > add collateral). If it cannot run (cooldown, daily cap, spent collateral
// budget, below one lot), the next breached rule is tried. Closing is the last line of defence, so it
// ignores the cooldown and the daily cap; closing a position that is already gone is a no-op on-chain.
import type { MarketSymbol } from "../perpl/network";
import { fractionOfLots } from "../perpl/orders";
import type { PositionMetrics, Side } from "../risk/metrics";
import type { GuardianMandate, GuardianRule, GuardianTrigger, ReduceFraction } from "./mandate";

export type GuardedPosition = {
  market: MarketSymbol;
  side: Side;
  lotLNS: bigint;
  markPriceValid: boolean;
  metrics: PositionMetrics;
};

export type GuardianState = {
  /** Last non-closing or closing action per market, in unix seconds. */
  lastActionAtSec: Partial<Record<MarketSymbol, number>>;
  /** Non-closing actions already taken in the current UTC day. */
  actionsToday: number;
  /** Collateral already added under this mandate, in USD. */
  collateralAddedUsd: number;
};

export const EMPTY_GUARDIAN_STATE: GuardianState = { lastActionAtSec: {}, actionsToday: 0, collateralAddedUsd: 0 };

export type TriggerHit = { trigger: GuardianTrigger; observed: number };

export type GuardianAction =
  | { market: MarketSymbol; type: "addCollateral"; usd: number; hit: TriggerHit }
  | { market: MarketSymbol; type: "reduce"; fraction: ReduceFraction; lotLNS: bigint; hit: TriggerHit }
  | { market: MarketSymbol; type: "close"; lotLNS: bigint; hit: TriggerHit };

export type SkipReason =
  | "notCovered"
  | "unknownSide"
  | "invalidMark"
  | "metricsUnavailable"
  | "cooldown"
  | "dailyCap"
  | "collateralBudget"
  | "tooSmall";

export type GuardianSkip = { market: MarketSymbol; reason: SkipReason; hit?: TriggerHit };

export type GuardianDecision = { actions: GuardianAction[]; skipped: GuardianSkip[] };

/** The value a trigger compares, or null when the metrics needed for it are unknown. */
function observe(trigger: GuardianTrigger, m: PositionMetrics): number | null {
  switch (trigger.kind) {
    case "liquidationBuffer":
      return m.maintenanceBufferPct;
    case "drawdown":
      return m.unrealizedPnlUsd === null || !(m.collateralUsd > 0)
        ? null
        : (Math.max(0, -m.unrealizedPnlUsd) / m.collateralUsd) * 100;
    case "maxLeverage":
      // metrics leave leverage null when equity <= 0; an insolvent position is the most levered there is.
      if (m.effectiveLeverage === null && m.equityUsd !== null && m.equityUsd <= 0 && m.notionalUsd > 0) {
        return Number.POSITIVE_INFINITY;
      }
      return m.effectiveLeverage;
  }
}

function isBreached(trigger: GuardianTrigger, observed: number): boolean {
  switch (trigger.kind) {
    case "liquidationBuffer":
      return observed < trigger.belowPct;
    case "drawdown":
      return observed >= trigger.lossPct;
    case "maxLeverage":
      return observed > trigger.above;
  }
}

function severity(rule: GuardianRule): number {
  const a = rule.action;
  return a.type === "close" ? 100 : a.type === "reduce" ? a.fraction * 100 : 10;
}

type Budget = { actionsToday: number; collateralAddedUsd: number };

function tryRule(
  rule: GuardianRule,
  hit: TriggerHit,
  p: GuardedPosition,
  mandate: GuardianMandate,
  state: GuardianState,
  budget: Budget,
  nowSec: number,
): GuardianAction | SkipReason {
  const a = rule.action;
  if (a.type === "close") return { market: p.market, type: "close", lotLNS: p.lotLNS, hit };
  const last = state.lastActionAtSec[p.market];
  if (last !== undefined && nowSec - last < mandate.cooldownSec) return "cooldown";
  if (budget.actionsToday >= mandate.maxActionsPerDay) return "dailyCap";
  if (a.type === "addCollateral") {
    if (budget.collateralAddedUsd + a.usd > mandate.collateralBudgetUsd + 1e-9) return "collateralBudget";
    return { market: p.market, type: "addCollateral", usd: a.usd, hit };
  }
  const lots = fractionOfLots(p.lotLNS, a.fraction);
  if (lots === 0n) return "tooSmall";
  return { market: p.market, type: "reduce", fraction: a.fraction, lotLNS: lots, hit };
}

function decideForPosition(
  p: GuardedPosition,
  mandate: GuardianMandate,
  state: GuardianState,
  budget: Budget,
  nowSec: number,
): GuardianAction | GuardianSkip | null {
  if (!mandate.markets.includes(p.market)) return { market: p.market, reason: "notCovered" };
  if (p.side === "unknown") return { market: p.market, reason: "unknownSide" };
  if (!p.markPriceValid) return { market: p.market, reason: "invalidMark" };

  const observed = mandate.rules.map(rule => ({ rule, value: observe(rule.trigger, p.metrics) }));
  if (observed.every(o => o.value === null)) return { market: p.market, reason: "metricsUnavailable" };

  const breached = observed
    .filter((o): o is { rule: GuardianRule; value: number } => o.value !== null && isBreached(o.rule.trigger, o.value))
    .sort((x, y) => severity(y.rule) - severity(x.rule));
  if (breached.length === 0) return null;

  let firstSkip: GuardianSkip | undefined;
  for (const { rule, value } of breached) {
    const hit = { trigger: rule.trigger, observed: value };
    const result = tryRule(rule, hit, p, mandate, state, budget, nowSec);
    if (typeof result !== "string") return result;
    firstSkip ??= { market: p.market, reason: result, hit };
  }
  return firstSkip ?? null;
}

export function evaluateGuardian(
  mandate: GuardianMandate,
  positions: GuardedPosition[],
  state: GuardianState,
  nowSec: number,
): GuardianDecision {
  const budget: Budget = { actionsToday: state.actionsToday, collateralAddedUsd: state.collateralAddedUsd };
  const actions: GuardianAction[] = [];
  const skipped: GuardianSkip[] = [];
  // Worst buffer first, so a shared daily cap or collateral budget goes to the position that needs it most.
  const byRisk = [...positions].sort(
    (a, b) => (a.metrics.maintenanceBufferPct ?? Infinity) - (b.metrics.maintenanceBufferPct ?? Infinity),
  );
  for (const p of byRisk) {
    const outcome = decideForPosition(p, mandate, state, budget, nowSec);
    if (outcome === null) continue;
    if ("type" in outcome) {
      actions.push(outcome);
      if (outcome.type !== "close") budget.actionsToday += 1;
      if (outcome.type === "addCollateral") budget.collateralAddedUsd += outcome.usd;
    } else {
      skipped.push(outcome);
    }
  }
  return { actions, skipped };
}
