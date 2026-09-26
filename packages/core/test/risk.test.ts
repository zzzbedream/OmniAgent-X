import { describe, expect, it } from "vitest";
import { DEFAULT_TESTNET_POLICY, evaluatePlan } from "../src/strategy/risk";
import type { TradePlan } from "../src/strategy/schema";

const plan = (orders: TradePlan["orders"]): TradePlan => ({ orders, summary: "", riskNotes: "" });

describe("evaluatePlan", () => {
  it("accepts a plan whose margin fits the budget", () => {
    const r = evaluatePlan(plan([{ market: "ETH", side: "short", notionalUsd: 600, leverage: 2 }]), 1000);
    expect(r.ok).toBe(true);
    expect(r.requiredMarginUsd).toBe(300);
    expect(r.totalNotionalUsd).toBe(600);
  });
  it("rejects margin above budget instead of clamping", () => {
    const r = evaluatePlan(plan([{ market: "ETH", side: "short", notionalUsd: 2500, leverage: 2 }]), 1000);
    expect(r.ok).toBe(false);
    expect(r.violations.map(v => v.rule)).toContain("budget");
  });
  it("rejects leverage, duplicate markets, size bounds and empty plans", () => {
    const r = evaluatePlan(
      plan([
        { market: "BTC", side: "long", notionalUsd: 100, leverage: 5 },
        { market: "BTC", side: "short", notionalUsd: 1, leverage: 1 },
        { market: "SOL", side: "long", notionalUsd: 5000, leverage: 3 },
      ]),
      10_000,
    );
    expect(r.violations.map(v => v.rule).sort()).toEqual(
      ["duplicateMarket", "maxLeverage", "maxOrderNotional", "minOrderNotional"].sort(),
    );
    expect(evaluatePlan(plan([]), 100).violations.map(v => v.rule)).toContain("orders");
  });
  it("respects a stricter policy", () => {
    const r = evaluatePlan(plan([{ market: "MON", side: "long", notionalUsd: 50, leverage: 1 }]), 100, {
      ...DEFAULT_TESTNET_POLICY,
      allowedMarkets: ["BTC"],
    });
    expect(r.violations.map(v => v.rule)).toEqual(["market"]);
  });
});
