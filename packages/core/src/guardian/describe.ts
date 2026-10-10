// Plain-language (English, like the PWA) rendering of mandates and guardian decisions. Deterministic
// templates: the explanation of an action never depends on a model.
import type { GuardianAction, SkipReason } from "./engine";
import type { GuardianActionSpec, GuardianMandate, GuardianTrigger } from "./mandate";

const num = (x: number) => String(Number(x.toFixed(2)));

function triggerCondition(t: GuardianTrigger): string {
  switch (t.kind) {
    case "liquidationBuffer":
      return `If distance to liquidation falls below ${num(t.belowPct)}%`;
    case "drawdown":
      return `If the loss reaches ${num(t.lossPct)}% of collateral`;
    case "maxLeverage":
      return `If leverage exceeds ${num(t.above)}x`;
  }
}

function actionInfinitive(a: GuardianActionSpec): string {
  switch (a.type) {
    case "addCollateral":
      return `add ${num(a.usd)} USD of collateral`;
    case "reduce":
      return `reduce the position by ${num(a.fraction * 100)}%`;
    case "close":
      return "close the position";
  }
}

/** One line per rule, in mandate order, for the preview the user signs. */
export function describeMandate(m: GuardianMandate): string[] {
  return m.rules.map(r => `${triggerCondition(r.trigger)}: ${actionInfinitive(r.action)}.`);
}

function because(hit: GuardianAction["hit"]): string {
  const t = hit.trigger;
  switch (t.kind) {
    case "liquidationBuffer":
      return `distance to liquidation (${hit.observed.toFixed(1)}%) fell below ${num(t.belowPct)}%`;
    case "drawdown":
      return `the loss (${hit.observed.toFixed(1)}% of collateral) reached ${num(t.lossPct)}%`;
    case "maxLeverage":
      return `leverage (${hit.observed.toFixed(2)}x) exceeded ${num(t.above)}x`;
  }
}

function verb(a: GuardianAction, dryRun: boolean): string {
  switch (a.type) {
    case "addCollateral":
      return `${dryRun ? "would add" : "added"} ${num(a.usd)} USD of collateral`;
    case "reduce":
      return `${dryRun ? "would reduce" : "reduced"} the position by ${num(a.fraction * 100)}%`;
    case "close":
      return `${dryRun ? "would close" : "closed"} the position`;
  }
}

/** Explanation for the action feed. `dryRun` switches to the conditional voice ("would"). */
export function describeGuardianAction(a: GuardianAction, opts: { dryRun: boolean }): string {
  return `${a.market}: ${verb(a, opts.dryRun)} because ${because(a.hit)}.`;
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  notCovered: "the mandate does not cover this market",
  unknownSide: "the position's side is unknown (it was not opened by the app)",
  invalidMark: "the mark price is not valid right now",
  metricsUnavailable: "missing data to evaluate the rules (maintenance margin)",
  cooldown: "waiting: the last action was within the cooldown",
  dailyCap: "the daily action limit was reached",
  collateralBudget: "the mandate's collateral budget is used up",
  tooSmall: "the position is too small to reduce",
};
