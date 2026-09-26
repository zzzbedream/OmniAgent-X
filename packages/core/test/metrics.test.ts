import { describe, expect, it } from "vitest";
import { marginFractionFromRaw, portfolioSummary, positionMetrics } from "../src/risk/metrics";

// 1 ETH (lotDecimals 3 → 1000 lots), prices with 1 decimal, 6-decimal collateral.
const base = {
  lotLNS: 1000n,
  entryPricePNS: 20_000n, // 2000.0
  depositCNS: 400_000_000n, // 400
  priceDecimals: 1,
  lotDecimals: 3,
  collateralDecimals: 6,
  maintenanceFraction: 0.05,
};

describe("marginFractionFromRaw", () => {
  it("matches both examples in Perpl's docs", () => {
    expect(marginFractionFromRaw(2000)).toBeCloseTo(0.05); // maintenance 2000 = 5%
    expect(marginFractionFromRaw(1000)).toBeCloseTo(0.1); // initial 1000 = 10%
    expect(marginFractionFromRaw(0)).toBeNull();
  });
});

describe("positionMetrics", () => {
  it("long: PnL, leverage and a liquidation price where equity = maintenance", () => {
    const m = positionMetrics({ ...base, side: "long", markPricePNS: 21_000n });
    expect(m.unrealizedPnlUsd).toBeCloseTo(100);
    expect(m.equityUsd).toBeCloseTo(500);
    expect(m.notionalUsd).toBeCloseTo(2100);
    expect(m.effectiveLeverage).toBeCloseTo(4.2);
    expect(m.maintenanceBufferPct).toBeCloseTo((500 / 2100 - 0.05) * 100);
    expect(m.estLiquidationPrice).toBeCloseTo(1600 / 0.95, 6);
    const p = m.estLiquidationPrice!;
    expect(400 + (p - 2000)).toBeCloseTo(0.05 * p, 6);
  });
  it("short: the liquidation price sits above entry", () => {
    const m = positionMetrics({ ...base, side: "short", markPricePNS: 19_000n });
    expect(m.unrealizedPnlUsd).toBeCloseTo(100);
    expect(m.estLiquidationPrice).toBeCloseTo(2400 / 1.05, 6);
    const p = m.estLiquidationPrice!;
    expect(400 + (2000 - p)).toBeCloseTo(0.05 * p, 6);
  });
  it("refuses to guess when the side is unknown", () => {
    const m = positionMetrics({ ...base, side: "unknown", markPricePNS: 21_000n });
    expect(m.notionalUsd).toBeCloseTo(2100);
    expect(m.unrealizedPnlUsd).toBeNull();
    expect(m.estLiquidationPrice).toBeNull();
  });
  it("omits the liquidation estimate without a maintenance margin", () => {
    const m = positionMetrics({ ...base, side: "long", markPricePNS: 21_000n, maintenanceFraction: null });
    expect(m.estLiquidationPrice).toBeNull();
    expect(m.maintenanceBufferPct).toBeNull();
    expect(m.unrealizedPnlUsd).toBeCloseTo(100);
  });
});

describe("portfolioSummary", () => {
  it("aggregates exposure, concentration and the tightest buffer", () => {
    const long = positionMetrics({ ...base, side: "long", markPricePNS: 21_000n });
    const short = positionMetrics({ ...base, side: "short", markPricePNS: 19_000n });
    const s = portfolioSummary([
      { side: "long", metrics: long },
      { side: "short", metrics: short },
    ]);
    expect(s.totalNotionalUsd).toBeCloseTo(4000);
    expect(s.longNotionalUsd).toBeCloseTo(2100);
    expect(s.shortNotionalUsd).toBeCloseTo(1900);
    expect(s.concentration).toBeCloseTo(2100 / 4000);
    expect(s.totalUnrealizedPnlUsd).toBeCloseTo(200);
    expect(s.minMaintenanceBufferPct).toBeCloseTo(Math.min(long.maintenanceBufferPct!, short.maintenanceBufferPct!));
  });
  it("propagates an unknown PnL instead of summing a partial one", () => {
    const u = positionMetrics({ ...base, side: "unknown", markPricePNS: 21_000n });
    expect(portfolioSummary([{ side: "unknown", metrics: u }]).totalUnrealizedPnlUsd).toBeNull();
  });
});

import { marketRow } from "../src/risk/metrics";

describe("marketRow", () => {
  it("derives spread, mark/oracle deviation and 24h change", () => {
    const r = marketRow({ mrk: 20_100, orl: 20_000, bid: 20_090, ask: 20_110, prv: 19_000, oi: 5_000 }, 1, 3);
    expect(r.mark).toBe(2010);
    expect(r.spreadBps).toBeCloseTo((2 / 2010) * 10_000);
    expect(r.markOracleDevBps).toBeCloseTo(50);
    expect(r.change24hPct).toBeCloseTo((1100 / 19_000) * 100);
    expect(r.openInterest).toBe(5);
  });
  it("returns null signals for an empty book or missing oracle", () => {
    const r = marketRow({ mrk: 1, orl: 0, bid: 0, ask: 0, prv: 0, oi: 0 }, 0, 0);
    expect(r.spreadBps).toBeNull();
    expect(r.markOracleDevBps).toBeNull();
    expect(r.change24hPct).toBeNull();
  });
});
