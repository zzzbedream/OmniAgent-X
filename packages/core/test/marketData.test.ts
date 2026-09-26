import { describe, expect, it } from "vitest";
import { heartbeatGap, parseMarketDataMessage, subscriptionFrame, summarizeContext } from "../src/perpl/marketData";

describe("market-data protocol", () => {
  it("builds one subscription frame for market state and heartbeat", () => {
    expect(subscriptionFrame(10143)).toEqual({
      mt: 5,
      subs: [
        { stream: "market-state@10143", subscribe: true },
        { stream: "heartbeat@10143", subscribe: true },
      ],
    });
  });
  it("parses market state, heartbeat and per-subscription failures", () => {
    const ms = parseMarketDataMessage(JSON.stringify({ mt: 9, d: { "32": { mrk: 25000, orl: 24990 }, "16": null } }));
    expect(ms.kind).toBe("market-state");
    if (ms.kind === "market-state") expect(Object.keys(ms.states)).toEqual(["32"]);
    expect(parseMarketDataMessage(JSON.stringify({ mt: 100, sn: 5, h: 123 }))).toEqual({ kind: "heartbeat", sn: 5, head: 123 });
    expect(
      parseMarketDataMessage(
        JSON.stringify({ mt: 6, subs: [{ stream: "x", status: { code: 404, error: "unknown stream" } }, { stream: "y", sid: 1 }] }),
      ),
    ).toEqual({
      kind: "subscription",
      subs: [
        { stream: "x", code: 404, error: "unknown stream" },
        { stream: "y", code: 0, error: undefined },
      ],
    });
    expect(parseMarketDataMessage("not json")).toEqual({ kind: "other", mt: undefined });
  });
  it("flags heartbeat gaps", () => {
    expect(heartbeatGap(undefined, 10)).toBe(false);
    expect(heartbeatGap(10, 11)).toBe(false);
    expect(heartbeatGap(10, 12)).toBe(true);
  });
  it("summarizes the public context and rejects unknown shapes", () => {
    const ctx = {
      markets: [
        { id: 32, symbol: "ETH", config: { price_decimals: 1, size_decimals: 3, initial_margin: 1000, maintenance_margin: 2000 } },
      ],
    };
    expect(summarizeContext(ctx)).toEqual([
      { id: 32, symbol: "ETH", priceDecimals: 1, sizeDecimals: 3, initialMarginRaw: 1000, maintenanceMarginRaw: 2000 },
    ]);
    expect(() => summarizeContext({})).toThrow(/markets/);
    expect(() => summarizeContext({ markets: [{ id: 1, symbol: "X", config: {} }] })).toThrow(/decimals/);
  });
});
