import { APPROVAL_DOMAIN, PLAN_APPROVAL_TYPES, hashPlanOrders, usdToMicro } from "@omniagent/core";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ValidationError, validateSubmission } from "../src/validate";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const account = "0x000000000000000000000000000000000000dEaD";
const plan = { orders: [{ market: "ETH" as const, side: "short" as const, notionalUsd: 600, leverage: 2 }], summary: "s", riskNotes: "r" };
const NOW = 1_900_000_000n;

async function submission(overrides: Partial<Record<string, unknown>> = {}, signer = owner) {
  const message = {
    owner: owner.address,
    account,
    planHash: hashPlanOrders(plan),
    budgetMicroUsd: usdToMicro(1000),
    nonce: 7n,
    deadline: NOW + 600n,
    ...overrides,
  } as const;
  const signature = await signer.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: PLAN_APPROVAL_TYPES,
    primaryType: "PlanApproval",
    message: message as never,
  });
  const wire = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  return { plan, budgetUsd: 1000, approval: { message: wire, signature } };
}

const opts = { chainId: 10143, nowSec: NOW, isNonceUsed: () => false };

describe("validateSubmission", () => {
  it("accepts a correctly signed, in-policy plan", async () => {
    const v = await validateSubmission(await submission(), opts);
    expect(v.message.owner).toBe(owner.address);
    expect(v.risk.requiredMarginUsd).toBe(300);
  });
  it("rejects a signature from someone else", async () => {
    await expect(validateSubmission(await submission({}, stranger), opts)).rejects.toThrow(/not from the owner/);
  });
  it("rejects expired approvals, reused nonces, tampered budgets and hashes", async () => {
    await expect(validateSubmission(await submission({ deadline: NOW - 1n }), opts)).rejects.toThrow(/expired/);
    await expect(validateSubmission(await submission(), { ...opts, isNonceUsed: () => true })).rejects.toThrow(/nonce/);
    const s = await submission();
    await expect(validateSubmission({ ...s, budgetUsd: 5000 }, opts)).rejects.toThrow(/budget/);
    await expect(validateSubmission(await submission({ planHash: `0x${"11".repeat(32)}` }), opts)).rejects.toThrow(
      /planHash/,
    );
  });
  it("rejects plans outside the risk policy before looking at signatures", async () => {
    const s = await submission();
    const bad = { ...s, plan: { ...plan, orders: [{ ...plan.orders[0], leverage: 10 }] } };
    const err = await validateSubmission(bad, opts).catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/risk policy/);
  });
  it("rejects malformed bodies", async () => {
    await expect(validateSubmission({ plan: {} }, opts)).rejects.toThrow(/malformed/);
  });
});
