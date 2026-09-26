import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { exchangeAbi } from "../src/perpl/abi";
import { CURRENT_OPERATOR_SELECTORS, EXEC_ORDER_SELECTOR } from "../src/perpl/allowlist";

// Expected values from `solc --hashes` on PerplFoundation/delegated-account interfaces/IExchange.sol
// and the asserts in its fork test (execOrder 0x4d8dc985).
const EXPECTED: Record<string, string> = {
  execOrder: "0x4d8dc985",
  depositCollateral: "0xbad4a01f",
  getExchangeInfo: "0x8bc5b3c5",
  getAccountById: "0x05aca141",
  getPerpetualInfo: "0x00092cce",
};

describe("hand-written Exchange ABI", () => {
  it("produces the compiler's selectors", () => {
    for (const f of exchangeAbi) {
      if (f.type !== "function") continue;
      expect(toFunctionSelector(f), f.name).toBe(EXPECTED[f.name]);
    }
  });
  it("uses the same execOrder selector the allowlist grants", () => {
    const execOrder = exchangeAbi.find(f => f.type === "function" && f.name === "execOrder")!;
    expect(toFunctionSelector(execOrder)).toBe(EXEC_ORDER_SELECTOR);
    expect(CURRENT_OPERATOR_SELECTORS.map(s => s.selector)).toContain(EXEC_ORDER_SELECTOR);
  });
});
