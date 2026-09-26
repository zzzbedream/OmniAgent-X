import { describe, expect, it } from "vitest";
import {
  OrderBuildError,
  OrderDescType,
  type PerpSnapshot,
  buildOpenIocOrder,
  buildPostOnlyTestBid,
  notionalToLots,
} from "../src/perpl/orders";

// BTC-PERP on testnet per Perpl's fork test: priceDecimals = 1, lotDecimals = 5.
const btc: PerpSnapshot = {
  priceDecimals: 1n,
  lotDecimals: 5n,
  markPNS: 1_000_000n, // 100,000.0 USD
  basePricePNS: 990_000n,
  maxBidPriceONS: 9_990n, // best bid 99,999.0
  minAskPriceONS: 10_010n, // best ask 100,001.0
};

describe("on-chain enum", () => {
  it("starts at OpenLong = 0 (differs from the REST OrderType)", () => {
    expect(OrderDescType.OpenLong).toBe(0);
    expect(OrderDescType.OpenShort).toBe(1);
    expect(OrderDescType.Cancel).toBe(4);
  });
});

describe("notionalToLots", () => {
  it("converts USD notional at mark to lots, rounding down", () => {
    // 100 USD / 100,000 USD per BTC = 0.001 BTC = 100 lots at 5 decimals
    expect(notionalToLots(100, btc)).toBe(100n);
    expect(notionalToLots(100.009, btc)).toBe(100n);
  });
  it("rejects notionals below one lot", () => {
    expect(() => notionalToLots(0.5, btc)).toThrow(OrderBuildError);
  });
  it("rejects a missing mark price", () => {
    expect(() => notionalToLots(100, { ...btc, markPNS: 0n })).toThrow(/mark price/);
  });
});

describe("buildOpenIocOrder", () => {
  it("prices a long above mark and a short below mark by the slippage", () => {
    const long = buildOpenIocOrder({ market: "BTC", side: "long", notionalUsd: 100, leverage: 2 }, btc, {
      slippageBps: 50,
      currentBlock: 1000n,
    });
    expect(long.pricePNS).toBe(1_005_000n);
    expect(long.orderType).toBe(OrderDescType.OpenLong);
    expect(long.perpId).toBe(16n);
    expect(long.leverageHdths).toBe(200n);
    expect(long.immediateOrCancel).toBe(true);
    expect(long.postOnly).toBe(false);
    expect(long.expiryBlock).toBe(1100n);

    const short = buildOpenIocOrder({ market: "BTC", side: "short", notionalUsd: 100, leverage: 1 }, btc, {
      slippageBps: 50,
      currentBlock: 1000n,
    });
    expect(short.pricePNS).toBe(995_000n);
    expect(short.orderType).toBe(OrderDescType.OpenShort);
  });
  it("rejects leverage below 1x and absurd slippage", () => {
    const i = { market: "BTC" as const, side: "long" as const, notionalUsd: 100, leverage: 0.5 };
    expect(() => buildOpenIocOrder(i, btc, { slippageBps: 50, currentBlock: 1n })).toThrow(/leverage/);
    expect(() => buildOpenIocOrder({ ...i, leverage: 1 }, btc, { slippageBps: 5000, currentBlock: 1n })).toThrow(
      /slippage/,
    );
  });
});

describe("buildPostOnlyTestBid", () => {
  it("rests one USD under the best bid, like Perpl's fork test", () => {
    const o = buildPostOnlyTestBid("BTC", btc, 10n, 500n);
    expect(o.pricePNS).toBe(990_000n + 9_990n - 10n);
    expect(o.postOnly).toBe(true);
    expect(o.expiryBlock).toBe(1500n);
    expect(o.leverageHdths).toBe(100n);
  });
  it("refuses an empty book", () => {
    expect(() => buildPostOnlyTestBid("BTC", { ...btc, maxBidPriceONS: 0n }, 10n, 1n)).toThrow(/no bids/);
  });
});
