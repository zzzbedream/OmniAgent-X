import { describe, expect, it } from "vitest";
import { type SideLogEntry, sideFromDecisionLog } from "../src/perpl/decisionSide";

const account = "0x000000000000000000000000000000000000dEaD";
const entry = (over: Partial<SideLogEntry>): SideLogEntry => ({
  kind: "plan",
  account,
  mode: "live",
  status: "sent",
  ...over,
});

describe("sideFromDecisionLog", () => {
  it("takes the side of the newest live open the worker actually sent", () => {
    const newestFirst = [
      entry({ detail: [{ order: { perpId: "32", orderType: 1 }, txHash: "0xabc" }] }),
      entry({ detail: [{ order: { perpId: "32", orderType: 0 }, txHash: "0xdef" }] }),
    ];
    expect(sideFromDecisionLog(newestFirst, account, 32n, "live")).toBe("short");
  });

  it("ignores dry-run builds and unsent live orders in live mode", () => {
    const newestFirst = [
      entry({ mode: "dry-run", status: "built", detail: [{ order: { perpId: "32", orderType: 0 } }] }),
      entry({ status: "failed", detail: [{ order: { perpId: "32", orderType: 0 } }] }),
    ];
    expect(sideFromDecisionLog(newestFirst, account, 32n, "live")).toBeUndefined();
    expect(sideFromDecisionLog(newestFirst, account, 32n, "dry-run")).toBe("long");
  });

  it("forgets the side once a close was sent after the open", () => {
    const newestFirst = [
      entry({ kind: "close", detail: { perpId: "32" } }),
      entry({ detail: [{ order: { perpId: "32", orderType: 1 }, txHash: "0xabc" }] }),
    ];
    expect(sideFromDecisionLog(newestFirst, account, 32n, "live")).toBeUndefined();
  });

  it("only looks at the given account and market", () => {
    const newestFirst = [entry({ detail: [{ order: { perpId: "32", orderType: 1 }, txHash: "0xabc" }] })];
    expect(sideFromDecisionLog(newestFirst, account, 16n, "live")).toBeUndefined();
    expect(sideFromDecisionLog(newestFirst, "0x0000000000000000000000000000000000000001", 32n, "live")).toBeUndefined();
    expect(sideFromDecisionLog(newestFirst, account.toLowerCase(), 32n, "live")).toBe("short");
  });

  it("never maps close order types to an open side", () => {
    const newestFirst = [entry({ detail: [{ order: { perpId: "32", orderType: 2 }, txHash: "0xabc" }] })];
    expect(sideFromDecisionLog(newestFirst, account, 32n, "live")).toBeUndefined();
  });
});
