import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  GUARDIAN_DEFAULTS,
  GUARDIAN_MANDATE_TYPES,
  GuardianMandateSchema,
  finalizeMandate,
  hashMandate,
  validateMandate,
} from "../src/guardian/mandate";
import { APPROVAL_DOMAIN } from "../src/strategy/approval";

const mandate = {
  version: 1 as const,
  markets: ["BTC" as const],
  rules: [
    { trigger: { kind: "liquidationBuffer" as const, belowPct: 15 }, action: { type: "addCollateral" as const, usd: 20 } },
    { trigger: { kind: "liquidationBuffer" as const, belowPct: 8 }, action: { type: "reduce" as const, fraction: 0.5 as const } },
    { trigger: { kind: "liquidationBuffer" as const, belowPct: 4 }, action: { type: "close" as const } },
  ],
  cooldownSec: 300,
  maxActionsPerDay: 6,
  collateralBudgetUsd: 20,
};

describe("GuardianMandateSchema", () => {
  it("accepts a graduated mandate", () => {
    expect(GuardianMandateSchema.safeParse(mandate).success).toBe(true);
  });

  it.each([
    ["a reduce fraction outside the allowed set", { action: { type: "reduce", fraction: 0.3 } }],
    ["a buffer threshold above 50%", { trigger: { kind: "liquidationBuffer", belowPct: 80 } }],
    ["an unknown action", { action: { type: "withdraw" } }],
  ])("rejects %s", (_label, patch) => {
    const bad = { ...mandate, rules: [{ ...mandate.rules[0], ...patch }] };
    expect(GuardianMandateSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a cooldown shorter than 30 s", () => {
    expect(GuardianMandateSchema.safeParse({ ...mandate, cooldownSec: 5 }).success).toBe(false);
  });
});

describe("hashMandate", () => {
  it("does not depend on key order", () => {
    const reordered = {
      collateralBudgetUsd: 20,
      maxActionsPerDay: 6,
      cooldownSec: 300,
      rules: mandate.rules.map(r => ({ action: r.action, trigger: r.trigger })),
      markets: ["BTC"],
      version: 1,
    };
    expect(hashMandate(reordered as typeof mandate)).toBe(hashMandate(mandate));
  });

  it("changes when a threshold changes", () => {
    const changed = { ...mandate, cooldownSec: 600 };
    expect(hashMandate(changed)).not.toBe(hashMandate(mandate));
  });
});

describe("finalizeMandate", () => {
  it("fills the fields the model left out with code defaults, never model guesses", () => {
    const m = finalizeMandate({
      rules: [{ trigger: { kind: "drawdown", lossPct: 30 }, action: { type: "addCollateral", usd: 25 } }],
    });
    expect(m.markets).toEqual(["BTC", "ETH", "SOL", "MON"]);
    expect(m.cooldownSec).toBe(GUARDIAN_DEFAULTS.cooldownSec);
    expect(m.maxActionsPerDay).toBe(GUARDIAN_DEFAULTS.maxActionsPerDay);
    // One top-up of the largest size the user named.
    expect(m.collateralBudgetUsd).toBe(25);
  });

  it("sets no collateral budget when no rule adds collateral", () => {
    const m = finalizeMandate({ rules: [{ trigger: { kind: "maxLeverage", above: 5 }, action: { type: "close" } }] });
    expect(m.collateralBudgetUsd).toBe(0);
  });
});

describe("validateMandate", () => {
  it("flags a top-up larger than the collateral budget", () => {
    const violations = validateMandate({ ...mandate, collateralBudgetUsd: 10 });
    expect(violations.map(v => v.rule)).toEqual(["collateralBudget"]);
  });

  it("passes a consistent mandate", () => {
    expect(validateMandate(mandate)).toEqual([]);
  });
});

describe("GuardianMandate EIP-712", () => {
  it("round-trips a signature over the mandate hash", async () => {
    const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const message = {
      owner: owner.address,
      account: "0x00000000000000000000000000000000000000aa" as const,
      mandateHash: hashMandate(mandate),
      nonce: 1n,
      expiresAt: 2_000_000_000n,
    };
    const domain = APPROVAL_DOMAIN(10143);
    const signature = await owner.signTypedData({ domain, types: GUARDIAN_MANDATE_TYPES, primaryType: "GuardianMandate", message });
    const ok = await verifyTypedData({
      address: owner.address,
      domain,
      types: GUARDIAN_MANDATE_TYPES,
      primaryType: "GuardianMandate",
      message,
      signature,
    });
    expect(ok).toBe(true);
  });
});
