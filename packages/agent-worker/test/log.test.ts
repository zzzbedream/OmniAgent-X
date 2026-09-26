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
