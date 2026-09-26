import { APPROVAL_DOMAIN, PLAN_APPROVAL_TYPES, hashPlanOrders, usdToMicro } from "@omniagent/core";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createWorker } from "../src/server";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const plan = { orders: [{ market: "ETH" as const, side: "short" as const, notionalUsd: 60, leverage: 2 }], summary: "", riskNotes: "" };

// RPC points at a closed port: whichever request gets past the nonce reservation fails on-chain (5xx).
const server = createWorker(
  loadConfig({
    OPERATOR_PK: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    DATA_DIR: mkdtempSync(join(tmpdir(), "omni-conc-")),
    MONAD_TESTNET_RPC: "http://127.0.0.1:9",
    RATE_LIMIT_PER_MIN: "0",
  }),
);
let base = "";
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function submission(nonce = 42n) {
  const message = {
    owner: owner.address,
    account: "0x000000000000000000000000000000000000dEaD" as const,
    planHash: hashPlanOrders(plan),
    budgetMicroUsd: usdToMicro(100),
    nonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };
  const signature = await owner.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: PLAN_APPROVAL_TYPES,
    primaryType: "PlanApproval",
    message,
  });
  const wire = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  return { plan, budgetUsd: 100, approval: { message: wire, signature } };
}

const post = (body: unknown) => fetch(`${base}/plans`, { method: "POST", body: JSON.stringify(body) });

describe("nonce reservation under concurrency", () => {
  it("lets exactly one of two identical approvals past the lock", async () => {
    const body = await submission();
    const [a, b] = await Promise.all([post(body), post(body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(400); // the loser: nonce already used
    expect(statuses[1]).toBeGreaterThanOrEqual(500); // the winner reached the (unreachable) chain
    const loser = a.status === 400 ? a : b;
    expect(((await loser.json()) as { error: string }).error).toMatch(/nonce already used/);
  });
});

describe("strict wire validation", () => {
  it("rejects a short plan hash and an unrecoverable signature with 400", async () => {
    const good = await submission(43n);
    const shortHash = {
      ...good,
      approval: { ...good.approval, message: { ...good.approval.message, planHash: "0x1234" } },
    };
    expect((await post(shortHash)).status).toBe(400);
    const junkSig = { ...good, approval: { ...good.approval, signature: `0x${"00".repeat(65)}` } };
    const r = await post(junkSig);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/signature/);
  });
});
