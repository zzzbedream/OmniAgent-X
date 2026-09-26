import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

const PROXY = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const OPERATOR = "0x3333333333333333333333333333333333333333" as const;
const STRANGER = "0x4444444444444444444444444444444444444444" as const;
const TX_A = `0x${"aa".repeat(32)}` as const;
const TX_B = `0x${"bb".repeat(32)}` as const;
const TX_C = `0x${"cc".repeat(32)}` as const;
const ETH = 32n;

const onboarding = [
  {
    contract: "DelegatedAccountFactory" as const,
    event: "DelegatedAccountCreated" as const,
    block: { number: 100 },
    params: { proxy: PROXY, owner: OWNER, operator: OPERATOR },
  },
  {
    contract: "Exchange" as const,
    event: "AccountCreated" as const,
    block: { number: 101 },
    params: { account: PROXY, id: 7n },
  },
  {
    contract: "Exchange" as const,
    event: "AccountCreated" as const,
    block: { number: 101 },
    params: { account: STRANGER, id: 8n },
  },
];

describe("Perpl indexer (simulated events)", () => {
  it("tracks only factory-created accounts", async t => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 10143: { simulate: onboarding } } });
    t.expect(await indexer.TrackedAccount.get("7")).toMatchObject({ delegatedAccount: PROXY, balanceCNS: 0n });
    t.expect(await indexer.TrackedAccount.get("8")).toBeUndefined();
    t.expect(await indexer.DelegatedAccount.getOrThrow(PROXY)).toMatchObject({ exchangeAccountId: 7n, owner: OWNER });
  });

  it("learns the side from the opening order, then reuses the calibration", async t => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            ...onboarding,
            {
              contract: "Exchange",
              event: "CollateralDeposit",
              block: { number: 102 },
              params: { accountId: 7n, amountCNS: 50_000_000n, balanceCNS: 60_000_000n },
            },
            {
              contract: "Exchange",
              event: "CollateralDeposit",
              block: { number: 102 },
              params: { accountId: 8n, amountCNS: 1n, balanceCNS: 1n },
            },
            {
              contract: "Exchange",
              event: "OrderRequest",
              block: { number: 103 },
              transaction: { hash: TX_A },
              params: { perpId: ETH, accountId: 7n, orderType: 1n, pricePNS: 2500n, lotLNS: 10n },
            },
            {
              contract: "Exchange",
              event: "PositionOpenedV2",
              block: { number: 103 },
              transaction: { hash: TX_A },
              params: {
                perpId: ETH,
                accountId: 7n,
                positionType: 2n,
                leverageHdths: 200n,
                depositCNS: 12_500_000n,
                pricePNS: 2500n,
                lotLNS: 10n,
              },
            },
            {
              contract: "Exchange",
              event: "PositionClosed",
              block: { number: 104 },
              transaction: { hash: TX_B },
              params: { perpId: ETH, accountId: 7n, positionType: 2n, pricePNS: 2400n, deltaPnlCNS: 1_000_000n, fundingCNS: -10_000n },
            },
            {
              // Opened later with no OrderRequest in the same tx: side must come from the calibration.
              contract: "Exchange",
              event: "PositionOpened",
              block: { number: 105 },
              transaction: { hash: TX_C },
              params: { perpId: 16n, accountId: 7n, positionType: 2n, leverageHdths: 100n, depositCNS: 5n, pricePNS: 1n, lotLNS: 1n },
            },
          ],
        },
      },
    });

    t.expect(await indexer.TrackedAccount.getOrThrow("7")).toMatchObject({ balanceCNS: 60_000_000n });
    t.expect(await indexer.SideCalibration.getOrThrow("2")).toMatchObject({ longCount: 0, shortCount: 1 });
    t.expect(await indexer.Position.getOrThrow("7-32")).toMatchObject({
      side: "short",
      status: "closed",
      lotLNS: 0n,
      realizedPnlCNS: 990_000n,
    });
    t.expect(await indexer.Position.getOrThrow("7-16")).toMatchObject({ side: "short", status: "open" });
    const events = await indexer.AccountEvent.getAll();
    t.expect(events.every(e => e.accountId === 7n)).toBe(true);
    t.expect(events.map(e => e.kind).sort()).toEqual(["close", "deposit", "open", "open", "order"]);
  });
});
