import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { APPROVAL_DOMAIN } from "../src/strategy/approval";
import {
  DailyQuota,
  PLAN_REQUEST_TYPES,
  guardianRequestHash,
  planRequestHash,
  verifyPlanRequest,
  verifySignedRequest,
} from "../src/strategy/requestAuth";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const account = "0x000000000000000000000000000000000000dEaD" as const;
const NOW = 1_900_000_000n;
const opts = { chainId: 10143, nowSec: NOW };

async function auth(request = "hedge ETH", budget = 100, deadline = NOW + 120n, signer = owner) {
  const signature = await signer.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: PLAN_REQUEST_TYPES,
    primaryType: "PlanRequest",
    message: { owner: owner.address, account, requestHash: planRequestHash(request, budget), deadline },
  });
  return { owner: owner.address, account, deadline: deadline.toString(), signature };
}

describe("verifyPlanRequest", () => {
  it("accepts the owner's signature over the exact request", async () => {
    await expect(verifyPlanRequest(await auth(), "hedge ETH", 100, opts)).resolves.toEqual({ owner: owner.address, account });
  });
  it("rejects missing auth, altered text or budget, expiry and long deadlines", async () => {
    await expect(verifyPlanRequest(undefined, "hedge ETH", 100, opts)).rejects.toThrow(/missing/);
    await expect(verifyPlanRequest(await auth(), "all in on ETH", 100, opts)).rejects.toThrow(/altered/);
    await expect(verifyPlanRequest(await auth(), "hedge ETH", 5000, opts)).rejects.toThrow(/altered/);
    await expect(verifyPlanRequest(await auth("hedge ETH", 100, NOW - 1n), "hedge ETH", 100, opts)).rejects.toThrow(/expired/);
    await expect(verifyPlanRequest(await auth("hedge ETH", 100, NOW + 3600n), "hedge ETH", 100, opts)).rejects.toThrow(/too far/);
  });
  it("rejects a stranger's signature", async () => {
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    await expect(verifyPlanRequest(await auth("hedge ETH", 100, NOW + 60n, stranger), "hedge ETH", 100, opts)).rejects.toThrow(
      /not signed/,
    );
  });
});

describe("DailyQuota", () => {
  it("limits per key and resets on a new day", () => {
    let day = "2026-09-26";
    const q = new DailyQuota(() => day);
    expect([q.take("a", 2), q.take("a", 2), q.take("a", 2), q.take("b", 2)]).toEqual([true, true, false, true]);
    day = "2026-09-27";
    expect(q.take("a", 2)).toBe(true);
  });
});

describe("guardian compile requests", () => {
  async function signHash(requestHash: `0x${string}`, deadline = NOW + 120n) {
    const signature = await owner.signTypedData({
      domain: APPROVAL_DOMAIN(10143),
      types: PLAN_REQUEST_TYPES,
      primaryType: "PlanRequest",
      message: { owner: owner.address, account, requestHash, deadline },
    });
    return { owner: owner.address, account, deadline: deadline.toString(), signature };
  }

  it("hashes guardian text apart from planning requests", () => {
    expect(guardianRequestHash("cierra si baja 5%")).not.toBe(planRequestHash("cierra si baja 5%", 0));
  });

  it("accepts the owner's signature over the guardian request hash", async () => {
    const hash = guardianRequestHash("reduce la mitad si me acerco a la liquidación");
    await expect(verifySignedRequest(await signHash(hash), hash, opts)).resolves.toEqual({ owner: owner.address, account });
  });

  it("does not accept a planning signature for a guardian request", async () => {
    const planAuth = await auth("texto", 0);
    await expect(verifySignedRequest(planAuth, guardianRequestHash("texto"), opts)).rejects.toThrow(/not signed by the owner/);
  });
});
