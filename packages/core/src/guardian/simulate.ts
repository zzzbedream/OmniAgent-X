// "What would the guardian do?" Replays a price path against one position with the same engine the
// worker runs. Used for the shock simulation in the PWA: no transaction, no network.
//
// Approximations (labelled as such in the UI): a reduction releases collateral pro rata and realizes
// nothing; funding and fees are ignored, as in risk/metrics.ts.
import type { MarketSymbol } from "../perpl/network";
import { type PositionInput, positionMetrics } from "../risk/metrics";
import { EMPTY_GUARDIAN_STATE, type GuardianAction, type GuardianSkip, type GuardianState, evaluateGuardian } from "./engine";
import type { GuardianMandate } from "./mandate";

export type SimStep = {
  t: number;
  move: number;
  markPrice: number;
  bufferPct: number | null;
  action?: GuardianAction;
  skipped: GuardianSkip[];
};

const PPM = 1_000_000;

function markAt(startPNS: bigint, move: number): bigint {
  return (startPNS * BigInt(Math.round((1 + move) * PPM))) / BigInt(PPM);
}

function applyAction(p: PositionInput, a: GuardianAction): PositionInput {
  if (a.type === "addCollateral") {
    return { ...p, depositCNS: p.depositCNS + BigInt(Math.round(a.usd * 10 ** p.collateralDecimals)) };
  }
  const remaining = p.lotLNS - a.lotLNS;
  return { ...p, lotLNS: remaining, depositCNS: p.lotLNS > 0n ? (p.depositCNS * remaining) / p.lotLNS : 0n };
}

function nextState(s: GuardianState, a: GuardianAction, market: MarketSymbol, t: number): GuardianState {
  return {
    lastActionAtSec: { ...s.lastActionAtSec, [market]: t },
    actionsToday: a.type === "close" ? s.actionsToday : s.actionsToday + 1,
    collateralAddedUsd: s.collateralAddedUsd + (a.type === "addCollateral" ? a.usd : 0),
  };
}

/**
 * @param path relative mark moves from the starting mark, one per step (e.g. -0.05 = 5% below start)
 * @param stepSec seconds between steps, which drives the cooldown
 */
export function simulateShock(args: {
  mandate: GuardianMandate;
  market: MarketSymbol;
  position: PositionInput;
  path: number[];
  stepSec?: number;
  state?: GuardianState;
}): SimStep[] {
  const stepSec = args.stepSec ?? 60;
  const startMark = args.position.markPricePNS;
  let position = args.position;
  let state = args.state ?? EMPTY_GUARDIAN_STATE;
  const steps: SimStep[] = [];

  for (const [i, move] of args.path.entries()) {
    const t = i * stepSec;
    position = { ...position, markPricePNS: markAt(startMark, move) };
    const metrics = positionMetrics(position);
    const { actions, skipped } = evaluateGuardian(
      args.mandate,
      [{ market: args.market, side: position.side, lotLNS: position.lotLNS, markPriceValid: true, metrics }],
      state,
      t,
    );
    const action = actions[0];
    steps.push({ t, move, markPrice: metrics.markPrice, bufferPct: metrics.maintenanceBufferPct, action, skipped });
    if (!action) continue;
    if (action.type === "close") break;
    position = applyAction(position, action);
    state = nextState(state, action, args.market, t);
  }
  return steps;
}
