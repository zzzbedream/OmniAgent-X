import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionLog } from "../src/log";

const entry = (nonce: string, status: "rejected" | "built") => ({
  ts: "t",
  kind: "plan" as const,
  owner: "0xAbC0000000000000000000000000000000000001",
  account: "0x00000000000000000000000000000000000000aa",
  nonce,
  planHash: "0x",
  mode: "dry-run" as const,
  status,
});

describe("DecisionLog", () => {
  it("marks nonces used, except for rejected entries, and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-log-"));
    const log = new DecisionLog(dir);
    log.append(entry("1", "built"));
    log.append(entry("2", "rejected"));
    const reopened = new DecisionLog(dir);
    expect(reopened.isNonceUsed("0xabc0000000000000000000000000000000000001", 1n)).toBe(true);
    expect(reopened.isNonceUsed("0xabc0000000000000000000000000000000000001", 2n)).toBe(false);
    expect(reopened.recent("0x00000000000000000000000000000000000000AA").map(e => e.nonce)).toEqual(["2", "1"]);
  });
});

describe("DecisionLog.reserve", () => {
  it("claims a nonce once, persists the claim, and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-reserve-"));
    const log = new DecisionLog(dir);
    const e = { ...entry("9", "built"), status: undefined } as unknown as Parameters<DecisionLog["reserve"]>[0];
    expect(log.reserve(e)).toBe(true);
    expect(log.reserve(e)).toBe(false);
    // simulated crash: the final result was never appended, the pending claim still blocks replay
    expect(new DecisionLog(dir).isNonceUsed("0xabc0000000000000000000000000000000000001", 9n)).toBe(true);
  });
});
