import { APPROVAL_DOMAIN, GUARDIAN_MANDATE_TYPES, GUARDIAN_REVOKE_TYPES, type GuardianMandate, hashMandate } from "@omniagent/core";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { MAX_MANDATE_TTL_SEC, validateMandateSubmission, validateRevoke } from "../src/validate";

const owner = privateKeyToAccount(`0x${"22".repeat(32)}`);
const other = privateKeyToAccount(`0x${"33".repeat(32)}`);
const account = "0x00000000000000000000000000000000000000aa";
const chainId = 10143;
const now = 1_800_000_000n;
const domain = APPROVAL_DOMAIN(chainId);

const mandate: GuardianMandate = {
  version: 1,
  markets: ["BTC"],
  rules: [{ trigger: { kind: "liquidationBuffer", belowPct: 8 }, action: { type: "reduce", fraction: 0.5 } }],
  cooldownSec: 300,
  maxActionsPerDay: 6,
  collateralBudgetUsd: 0,
};

async function submission(over: { mandate?: GuardianMandate; expiresAt?: bigint; signer?: typeof owner; hash?: `0x${string}` } = {}) {
  const m = over.mandate ?? mandate;
  const message = {
    owner: owner.address,
    account,
    mandateHash: over.hash ?? hashMandate(m),
    nonce: 7n,
    expiresAt: over.expiresAt ?? now + 86_400n,
  } as const;
  const signature = await (over.signer ?? owner).signTypedData({
    domain,
    types: GUARDIAN_MANDATE_TYPES,
    primaryType: "GuardianMandate",
    message,
  });
  return {
    mandate: m,
    approval: {
      message: { ...message, nonce: message.nonce.toString(), expiresAt: message.expiresAt.toString() },
      signature,
    },
  };
}

const opts = { chainId, nowSec: now, isNonceUsed: () => false };

describe("validateMandateSubmission", () => {
  it("accepts a mandate signed by the owner", async () => {
    const v = await validateMandateSubmission(await submission(), opts);
    expect(v.message.owner).toBe(owner.address);
    expect(v.mandateHash).toBe(hashMandate(mandate));
  });

  it("rejects a hash that does not match the mandate", async () => {
    const body = await submission({ hash: `0x${"ab".repeat(32)}` });
    await expect(validateMandateSubmission(body, opts)).rejects.toThrow(/mandateHash/);
  });

  it("rejects a signature from someone else", async () => {
    await expect(validateMandateSubmission(await submission({ signer: other }), opts)).rejects.toThrow(/owner/);
  });

  it("rejects an expired mandate and one that lasts too long", async () => {
    await expect(validateMandateSubmission(await submission({ expiresAt: now - 1n }), opts)).rejects.toThrow(/expired/);
    const tooLong = now + BigInt(MAX_MANDATE_TTL_SEC) + 1n;
    await expect(validateMandateSubmission(await submission({ expiresAt: tooLong }), opts)).rejects.toThrow(/too far/);
  });

  it("rejects an inconsistent mandate before checking the signature", async () => {
    const bad: GuardianMandate = {
      ...mandate,
      rules: [{ trigger: { kind: "drawdown", lossPct: 20 }, action: { type: "addCollateral", usd: 50 } }],
      collateralBudgetUsd: 10,
    };
    await expect(validateMandateSubmission(await submission({ mandate: bad }), opts)).rejects.toThrow(/mandate violates/);
  });

  it("rejects a reused nonce", async () => {
    await expect(validateMandateSubmission(await submission(), { ...opts, isNonceUsed: () => true })).rejects.toThrow(/nonce/);
  });
});

describe("validateRevoke", () => {
  async function revoke(deadline = now + 600n, signer = owner) {
    const message = { owner: owner.address, account, nonce: 8n, deadline } as const;
    const signature = await signer.signTypedData({ domain, types: GUARDIAN_REVOKE_TYPES, primaryType: "GuardianRevoke", message });
    return { message: { ...message, nonce: "8", deadline: deadline.toString() }, signature };
  }

  it("accepts the owner's revocation", async () => {
    const v = await validateRevoke(await revoke(), opts);
    expect(v.message.account.toLowerCase()).toBe(account);
  });

  it("rejects an expired or foreign revocation", async () => {
    await expect(validateRevoke(await revoke(now - 1n), opts)).rejects.toThrow(/expired/);
    await expect(validateRevoke(await revoke(now + 600n, other), opts)).rejects.toThrow(/owner/);
  });
});
