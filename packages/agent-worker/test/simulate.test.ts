import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { executePlan, simulateExecOrder } from "../src/executor";
import type { ValidatedPlan } from "../src/validate";

const OPERATOR = "0x00000000000000000000000000000000000000A1";
const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

// ETH-like snapshot: 2 price decimals, 4 lot decimals, mark 2489.29.
const perpInfo = {
  priceDecimals: 2n,
  lotDecimals: 4n,
  markPNS: 248929n,
  basePricePNS: 240000n,
  maxBidPriceONS: 8978n,
  minAskPriceONS: 9008n,
};

type SimCall = { account: unknown; address: string; functionName: string };

function mockClient(simulate: (call: SimCall) => Promise<unknown>) {
  const calls: SimCall[] = [];
  const client = {
    getBlockNumber: async () => 1000n,
    readContract: async () => perpInfo,
    simulateContract: async (call: SimCall) => {
      calls.push(call);
      return simulate(call);
    },
  } as unknown as PublicClient;
  return { client, calls };
}

const wallet = {
  account: { address: OPERATOR },
  writeContract: async () => {
    throw new Error("dry-run must never broadcast");
  },
} as never;

const plan = {
  plan: { orders: [{ market: "ETH", side: "short", notionalUsd: 5, leverage: 1 }] },
  message: { account: ACCOUNT },
} as unknown as ValidatedPlan;

describe("simulateExecOrder", () => {
  it("returns the orderId the exchange would assign", async () => {
    const { client, calls } = mockClient(async () => ({ result: { perpId: 32n, orderId: 7n } }));
    const sim = await simulateExecOrder(client, OPERATOR, ACCOUNT, {} as never);
    expect(sim).toEqual({ ok: true, orderId: "7" });
    // Same path as live: the operator calls the DelegatedAccount, whose fallback forwards to the Exchange.
    expect(calls[0]).toMatchObject({ account: OPERATOR, address: ACCOUNT, functionName: "execOrder" });
  });

  it("returns the revert reason instead of throwing", async () => {
    const { client } = mockClient(async () => {
      throw new Error("execution reverted: PriceOutOfBand");
    });
    const sim = await simulateExecOrder(client, OPERATOR, ACCOUNT, {} as never);
    expect(sim.ok).toBe(false);
    expect(!sim.ok && sim.error).toMatch(/PriceOutOfBand/);
  });
});

describe("executePlan in dry-run", () => {
  it("attaches an on-chain simulation to every built order and sends nothing", async () => {
    const { client, calls } = mockClient(async () => ({ result: { perpId: 32n, orderId: 9n } }));
    const result = await executePlan({ client, wallet, plan, slippageBps: 50, live: false });
    expect(result.mode).toBe("dry-run");
    expect(result.status).toBe("built");
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].simulation).toEqual({ ok: true, orderId: "9" });
    expect(result.orders[0].txHash).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("keeps a failed simulation visible without failing the request", async () => {
    const { client } = mockClient(async () => {
      throw new Error("execution reverted: InsufficientMargin");
    });
    const result = await executePlan({ client, wallet, plan, slippageBps: 50, live: false });
    expect(result.status).toBe("built");
    expect(result.orders[0].simulation).toMatchObject({ ok: false });
  });
});
