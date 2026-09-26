import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";
import { APPROVAL_DOMAIN, PLAN_APPROVAL_TYPES, hashPlanOrders, usdToMicro } from "../src/strategy/approval";

const orders = [{ market: "ETH" as const, side: "short" as const, notionalUsd: 600, leverage: 2 }];

describe("plan approval", () => {
  it("hash ignores free text but not order fields", () => {
    const h = hashPlanOrders({ orders });
    expect(hashPlanOrders({ orders: [...orders] })).toBe(h);
    expect(hashPlanOrders({ orders: [{ ...orders[0], leverage: 3 }] })).not.toBe(h);
  });
  it("round-trips an EIP-712 signature to the owner", async () => {
    const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const message = {
      owner: owner.address,
      account: "0x000000000000000000000000000000000000dEaD" as const,
      planHash: hashPlanOrders({ orders }),
      budgetMicroUsd: usdToMicro(1000),
      nonce: 1n,
      deadline: 2_000_000_000n,
    };
    const signature = await owner.signTypedData({
      domain: APPROVAL_DOMAIN(10143),
      types: PLAN_APPROVAL_TYPES,
      primaryType: "PlanApproval",
      message,
    });
    const recovered = await recoverTypedDataAddress({
      domain: APPROVAL_DOMAIN(10143),
      types: PLAN_APPROVAL_TYPES,
      primaryType: "PlanApproval",
      message,
      signature,
    });
    expect(recovered).toBe(owner.address);
  });
});
