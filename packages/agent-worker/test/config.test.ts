import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const OPERATOR = `0x${"11".repeat(32)}`;
const STATION = `0x${"22".repeat(32)}`;

describe("loadConfig account index", () => {
  it("is off without ACCOUNT_INDEX_FROM_BLOCK and parses a block number when set", () => {
    expect(loadConfig({ OPERATOR_PK: OPERATOR }).accountIndexFromBlock).toBeUndefined();
    expect(loadConfig({ OPERATOR_PK: OPERATOR, ACCOUNT_INDEX_FROM_BLOCK: "69250000" }).accountIndexFromBlock).toBe(
      69_250_000n,
    );
    expect(() => loadConfig({ OPERATOR_PK: OPERATOR, ACCOUNT_INDEX_FROM_BLOCK: "-1" })).toThrow(/ACCOUNT_INDEX_FROM_BLOCK/);
  });
});

describe("loadConfig gas station", () => {
  it("is off without GAS_STATION_PK", () => {
    expect(loadConfig({ OPERATOR_PK: OPERATOR }).gasStation).toBeUndefined();
  });

  it("defaults to a 0.5 MON drip and 40 fundings per day", () => {
    const gs = loadConfig({ OPERATOR_PK: OPERATOR, GAS_STATION_PK: STATION }).gasStation;
    expect(gs).toEqual({ pk: STATION, dripWei: 500_000_000_000_000_000n, dailyCap: 40 });
  });

  it("refuses the operator key, a malformed key and out-of-range amounts", () => {
    expect(() => loadConfig({ OPERATOR_PK: OPERATOR, GAS_STATION_PK: OPERATOR })).toThrow(/not be the operator/);
    expect(() => loadConfig({ OPERATOR_PK: OPERATOR, GAS_STATION_PK: "0x12" })).toThrow(/32-byte/);
    expect(() => loadConfig({ OPERATOR_PK: OPERATOR, GAS_STATION_PK: STATION, GAS_DRIP_MON: "50" })).toThrow(/GAS_DRIP_MON/);
    expect(() => loadConfig({ OPERATOR_PK: OPERATOR, GAS_STATION_PK: STATION, GAS_DAILY_CAP: "0" })).toThrow(/GAS_DAILY_CAP/);
  });
});
