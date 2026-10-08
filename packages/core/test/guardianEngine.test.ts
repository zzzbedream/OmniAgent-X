import { describe, expect, it } from "vitest";
import { EMPTY_GUARDIAN_STATE, type GuardedPosition, evaluateGuardian } from "../src/guardian/engine";
import type { GuardianMandate } from "../src/guardian/mandate";
import { simulateShock } from "../src/guardian/simulate";
import { fractionOfLots } from "../src/perpl/orders";
import { type PositionInput, positionMetrics } from "../src/risk/metrics";

// BTC-like units: price 1 decimal, size 5 decimals, AUSD 6 decimals, 4% maintenance.
function input(o: { side?: "long" | "short"; size?: number; entry?: number; mark: number; depositUsd: number }): PositionInput {
  return {
    side: o.side ?? "long",
    lotLNS: BigInt(Math.round((o.size ?? 0.01) * 1e5)),
    entryPricePNS: BigInt(Math.round((o.entry ?? 80_000) * 10)),
    markPricePNS: BigInt(Math.round(o.mark * 10)),
    depositCNS: BigInt(Math.round(o.depositUsd * 1e6)),
    priceDecimals: 1,
    lotDecimals: 5,
    collateralDecimals: 6,
    maintenanceFraction: 0.04,
  };
}

function pos(i: PositionInput, extra: Partial<GuardedPosition> = {}): GuardedPosition {
  return { market: "BTC", side: i.side, lotLNS: i.lotLNS, markPriceValid: true, metrics: positionMetrics(i), ...extra };
}

const ladder: GuardianMandate = {
  version: 1,
  markets: ["BTC"],
  rules: [
    { trigger: { kind: "liquidationBuffer", belowPct: 15 }, action: { type: "addCollateral", usd: 20 } },
    { trigger: { kind: "liquidationBuffer", belowPct: 8 }, action: { type: "reduce", fraction: 0.5 } },
    { trigger: { kind: "liquidationBuffer", belowPct: 4 }, action: { type: "close" } },
  ],
  cooldownSec: 300,
  maxActionsPerDay: 6,
  collateralBudgetUsd: 20,
};

// 0.01 BTC at 80,000 = 800 USD notional. Buffer = (equity / notional − 4%) in points.
const healthy = input({ mark: 80_000, depositUsd: 200 }); // 25 − 4 = 21 pts
const tight = input({ mark: 80_000, depositUsd: 120 }); // 15 − 4 = 11 pts → top-up zone
const danger = input({ mark: 80_000, depositUsd: 90 }); // 11.25 − 4 = 7.25 pts → reduce zone
const critical = input({ mark: 80_000, depositUsd: 60 }); // 7.5 − 4 = 3.5 pts → close zone

describe("fractionOfLots", () => {
  it("rounds down", () => {
    expect(fractionOfLots(1001n, 0.5)).toBe(500n);
  });
  it("returns 0 when the fraction is below one lot", () => {
    expect(fractionOfLots(1n, 0.5)).toBe(0n);
  });
});

describe("evaluateGuardian", () => {
  const now = 1_000_000;

  it("does nothing while every threshold holds", () => {
    expect(evaluateGuardian(ladder, [pos(healthy)], EMPTY_GUARDIAN_STATE, now)).toEqual({ actions: [], skipped: [] });
  });

  it("tops up collateral in the first zone", () => {
    const { actions } = evaluateGuardian(ladder, [pos(tight)], EMPTY_GUARDIAN_STATE, now);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ market: "BTC", type: "addCollateral", usd: 20 });
    expect(actions[0]!.hit.observed).toBeCloseTo(11, 5);
  });

  it("picks the most severe breached rule", () => {
    const { actions } = evaluateGuardian(ladder, [pos(danger)], EMPTY_GUARDIAN_STATE, now);
    expect(actions[0]).toMatchObject({ type: "reduce", fraction: 0.5, lotLNS: 500n });
    expect(evaluateGuardian(ladder, [pos(critical)], EMPTY_GUARDIAN_STATE, now).actions[0]).toMatchObject({
      type: "close",
      lotLNS: 1000n,
    });
  });

  it("falls through to the next breached rule when the collateral budget is spent", () => {
    const state = { ...EMPTY_GUARDIAN_STATE, collateralAddedUsd: 20 };
    const out = evaluateGuardian(ladder, [pos(tight)], state, now);
    expect(out.actions).toEqual([]);
    expect(out.skipped).toMatchObject([{ market: "BTC", reason: "collateralBudget" }]);
  });

  it("respects the cooldown for reductions but never delays a close", () => {
    const state = { ...EMPTY_GUARDIAN_STATE, lastActionAtSec: { BTC: now - 60 } };
    expect(evaluateGuardian(ladder, [pos(danger)], state, now).skipped).toMatchObject([{ reason: "cooldown" }]);
    expect(evaluateGuardian(ladder, [pos(critical)], state, now).actions[0]).toMatchObject({ type: "close" });
  });

  it("stops non-closing actions at the daily cap", () => {
    const state = { ...EMPTY_GUARDIAN_STATE, actionsToday: 6 };
    expect(evaluateGuardian(ladder, [pos(danger)], state, now).skipped).toMatchObject([{ reason: "dailyCap" }]);
    expect(evaluateGuardian(ladder, [pos(critical)], state, now).actions[0]).toMatchObject({ type: "close" });
  });

  it("refuses to act on an unknown side or an invalid mark price", () => {
    expect(evaluateGuardian(ladder, [pos(critical, { side: "unknown" })], EMPTY_GUARDIAN_STATE, now).skipped).toMatchObject([
      { reason: "unknownSide" },
    ]);
    expect(evaluateGuardian(ladder, [pos(critical, { markPriceValid: false })], EMPTY_GUARDIAN_STATE, now).skipped).toMatchObject([
      { reason: "invalidMark" },
    ]);
  });

  it("refuses to act when the maintenance margin is unknown", () => {
    const noMm = { ...critical, maintenanceFraction: null };
    expect(evaluateGuardian(ladder, [pos(noMm)], EMPTY_GUARDIAN_STATE, now).skipped).toMatchObject([
      { reason: "metricsUnavailable" },
    ]);
  });

  it("leaves markets outside the mandate alone", () => {
    const out = evaluateGuardian(ladder, [pos(critical, { market: "ETH" })], EMPTY_GUARDIAN_STATE, now);
    expect(out.actions).toEqual([]);
    expect(out.skipped).toMatchObject([{ market: "ETH", reason: "notCovered" }]);
  });

  it("skips a reduction smaller than one lot", () => {
    const oneLot = input({ size: 0.00001, mark: 80_000, depositUsd: 0.09 });
    const reduceOnly = { ...ladder, rules: [ladder.rules[1]!] };
    expect(evaluateGuardian(reduceOnly, [pos(oneLot)], EMPTY_GUARDIAN_STATE, now).skipped).toMatchObject([
      { reason: "tooSmall" },
    ]);
  });

  it("falls back to a milder feasible action when the severe one cannot run", () => {
    const oneLot = input({ size: 0.00001, mark: 80_000, depositUsd: 0.09 });
    expect(evaluateGuardian(ladder, [pos(oneLot)], EMPTY_GUARDIAN_STATE, now).actions[0]).toMatchObject({
      type: "addCollateral",
    });
  });

  it("evaluates drawdown and leverage triggers", () => {
    const m: GuardianMandate = {
      ...ladder,
      rules: [
        { trigger: { kind: "drawdown", lossPct: 40 }, action: { type: "reduce", fraction: 0.25 } },
        { trigger: { kind: "maxLeverage", above: 10 }, action: { type: "close" } },
      ],
    };
    // Long from 80,000 to 76,000 on 0.01 BTC: −40 USD on 100 USD of collateral = 40% loss, leverage 760/60 ≈ 12.7x.
    const losing = input({ mark: 76_000, depositUsd: 100 });
    const { actions } = evaluateGuardian(m, [pos(losing)], EMPTY_GUARDIAN_STATE, now);
    expect(actions[0]).toMatchObject({ type: "close", hit: { trigger: { kind: "maxLeverage" } } });
    const milder = evaluateGuardian({ ...m, rules: [m.rules[0]!] }, [pos(losing)], EMPTY_GUARDIAN_STATE, now);
    expect(milder.actions[0]).toMatchObject({ type: "reduce", fraction: 0.25 });
    expect(milder.actions[0]!.hit.observed).toBeCloseTo(40, 5);
  });

  it("treats an insolvent position as infinitely levered", () => {
    const m: GuardianMandate = { ...ladder, rules: [{ trigger: { kind: "maxLeverage", above: 10 }, action: { type: "close" } }] };
    const underwater = input({ mark: 70_000, depositUsd: 50 }); // −100 USD PnL on 50 USD collateral
    expect(evaluateGuardian(m, [pos(underwater)], EMPTY_GUARDIAN_STATE, now).actions[0]).toMatchObject({ type: "close" });
  });

  it("serves the worst position first when the daily cap allows one action", () => {
    const m = { ...ladder, markets: ["BTC" as const, "ETH" as const], maxActionsPerDay: 1 };
    const out = evaluateGuardian(m, [pos(tight, { market: "ETH" }), pos(danger)], EMPTY_GUARDIAN_STATE, now);
    expect(out.actions).toMatchObject([{ market: "BTC", type: "reduce" }]);
  });

  it("shares the daily cap and collateral budget across positions", () => {
    const m = { ...ladder, markets: ["BTC" as const, "ETH" as const], maxActionsPerDay: 1 };
    const out = evaluateGuardian(m, [pos(tight), pos(tight, { market: "ETH" })], EMPTY_GUARDIAN_STATE, now);
    expect(out.actions).toHaveLength(1);
    expect(out.skipped).toMatchObject([{ market: "ETH", reason: "dailyCap" }]);
  });
});

describe("simulateShock", () => {
  it("tops up first, then reduces, and a reduction improves the buffer", () => {
    const start = input({ mark: 80_000, depositUsd: 130 });
    const path = [-0.005, -0.03, -0.06, -0.08, -0.09];
    const steps = simulateShock({ mandate: ladder, market: "BTC", position: start, path, stepSec: 600 });
    const kinds = steps.filter(s => s.action).map(s => s.action!.type);
    expect(kinds.slice(0, 2)).toEqual(["addCollateral", "reduce"]);
    const reduceAt = steps.findIndex(s => s.action?.type === "reduce");
    expect(steps[reduceAt + 1]!.bufferPct!).toBeGreaterThan(steps[reduceAt]!.bufferPct!);
  });

  it("stops after a close", () => {
    const closeOnly = { ...ladder, rules: [ladder.rules[2]!] };
    const steps = simulateShock({ mandate: closeOnly, market: "BTC", position: critical, path: [0, -0.01, -0.02] });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.action?.type).toBe("close");
  });

  it("rejects a move of -100% or worse", () => {
    expect(() => simulateShock({ mandate: ladder, market: "BTC", position: healthy, path: [-1] })).toThrow(/move/);
  });

  it("does nothing on a flat path", () => {
    const steps = simulateShock({ mandate: ladder, market: "BTC", position: healthy, path: [0, 0, 0] });
    expect(steps.every(s => !s.action)).toBe(true);
  });
});
