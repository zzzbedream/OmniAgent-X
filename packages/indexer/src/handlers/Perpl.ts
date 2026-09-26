import { type EvmOnEventContext, indexer } from "envio";
import { type Side, flip, sideFromCalibration, sideFromOrderType } from "../side";

type Ctx = EvmOnEventContext;
type Evt = { transaction: { hash: string }; block: { number: number; timestamp: number }; logIndex: number };

const intentId = (tx: string, accountId: bigint, perpId: bigint) => `${tx}-${accountId}-${perpId}`;
const positionId = (accountId: bigint, perpId: bigint) => `${accountId}-${perpId}`;

async function tracked(context: Ctx, accountId: bigint) {
  return context.TrackedAccount.get(accountId.toString());
}

function recordEvent(
  context: Ctx,
  event: Evt,
  accountId: bigint,
  kind: string,
  extra: { perpId?: bigint; side?: Side; pricePNS?: bigint; lotLNS?: bigint; amountCNS?: bigint; fundingCNS?: bigint } = {},
) {
  context.AccountEvent.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    accountId,
    kind,
    perpId: extra.perpId,
    side: extra.side,
    pricePNS: extra.pricePNS,
    lotLNS: extra.lotLNS,
    amountCNS: extra.amountCNS,
    fundingCNS: extra.fundingCNS,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
}

/** Side of a position event: the opening order in the same tx if any, else the learned calibration. */
async function resolveSide(context: Ctx, event: Evt, accountId: bigint, perpId: bigint, positionTypeRaw: number) {
  const intent = await context.OrderIntent.get(intentId(event.transaction.hash, accountId, perpId));
  const fromOrder = sideFromOrderType(intent?.orderType);
  const calibration = await context.SideCalibration.get(positionTypeRaw.toString());
  if (fromOrder !== "unknown") {
    context.SideCalibration.set({
      id: positionTypeRaw.toString(),
      longCount: (calibration?.longCount ?? 0) + (fromOrder === "long" ? 1 : 0),
      shortCount: (calibration?.shortCount ?? 0) + (fromOrder === "short" ? 1 : 0),
    });
    return fromOrder;
  }
  return sideFromCalibration(calibration);
}

indexer.onEvent({ contract: "DelegatedAccountFactory", event: "DelegatedAccountCreated" }, async ({ event, context }) => {
  context.DelegatedAccount.set({
    id: event.params.proxy.toLowerCase(),
    owner: event.params.owner.toLowerCase(),
    operator: event.params.operator.toLowerCase(),
    exchangeAccountId: undefined,
    createdBlock: event.block.number,
  });
});

indexer.onEvent({ contract: "Exchange", event: "AccountCreated" }, async ({ event, context }) => {
  const delegated = await context.DelegatedAccount.get(event.params.account.toLowerCase());
  if (!delegated) return; // not created through the factory: ignore
  context.DelegatedAccount.set({ ...delegated, exchangeAccountId: event.params.id });
  context.TrackedAccount.set({
    id: event.params.id.toString(),
    delegatedAccount: delegated.id,
    balanceCNS: 0n,
    updatedBlock: event.block.number,
  });
});

for (const [name, kind] of [
  ["CollateralDeposit", "deposit"],
  ["CollateralWithdrawal", "withdrawal"],
] as const) {
  indexer.onEvent({ contract: "Exchange", event: name }, async ({ event, context }) => {
    const acc = await tracked(context, event.params.accountId);
    if (!acc) return;
    context.TrackedAccount.set({ ...acc, balanceCNS: event.params.balanceCNS, updatedBlock: event.block.number });
    recordEvent(context, event, event.params.accountId, kind, { amountCNS: event.params.amountCNS });
  });
}

indexer.onEvent({ contract: "Exchange", event: "OrderRequest" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.accountId))) return;
  const orderType = Number(p.orderType);
  context.OrderIntent.set({ id: intentId(event.transaction.hash, p.accountId, p.perpId), orderType });
  recordEvent(context, event, p.accountId, "order", {
    perpId: p.perpId,
    side: sideFromOrderType(orderType),
    pricePNS: p.pricePNS,
    lotLNS: p.lotLNS,
  });
});

indexer.onEvent({ contract: "Exchange", event: "MakerOrderFilled" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.accountId))) return;
  recordEvent(context, event, p.accountId, "fill", { perpId: p.perpId, pricePNS: p.pricePNS, lotLNS: p.lotLNS, amountCNS: p.amountCNS });
});

type OpenLike = {
  perpId: bigint;
  accountId: bigint;
  positionType: bigint;
  leverageHdths: bigint;
  depositCNS: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
};

async function onOpen(context: Ctx, event: Evt, p: OpenLike) {
  if (!(await tracked(context, p.accountId))) return;
  const raw = Number(p.positionType);
  const side = await resolveSide(context, event, p.accountId, p.perpId, raw);
  context.Position.set({
    id: positionId(p.accountId, p.perpId),
    accountId: p.accountId,
    perpId: p.perpId,
    positionTypeRaw: raw,
    side,
    lotLNS: p.lotLNS,
    depositCNS: p.depositCNS,
    entryPricePNS: p.pricePNS,
    leverageHdths: p.leverageHdths,
    status: "open",
    realizedPnlCNS: 0n,
    updatedBlock: event.block.number,
  });
  recordEvent(context, event, p.accountId, "open", { perpId: p.perpId, side, pricePNS: p.pricePNS, lotLNS: p.lotLNS, amountCNS: p.depositCNS });
}

indexer.onEvent({ contract: "Exchange", event: "PositionOpened" }, async ({ event, context }) =>
  onOpen(context, event, event.params),
);
indexer.onEvent({ contract: "Exchange", event: "PositionOpenedV2" }, async ({ event, context }) =>
  onOpen(context, event, event.params),
);

type IncreaseLike = OpenLike & { endDepositCNS: bigint; endLotLNS: bigint };

async function onIncrease(context: Ctx, event: Evt, p: Omit<IncreaseLike, "depositCNS" | "lotLNS">) {
  if (!(await tracked(context, p.accountId))) return;
  const raw = Number(p.positionType);
  const side = await resolveSide(context, event, p.accountId, p.perpId, raw);
  const prev = await context.Position.get(positionId(p.accountId, p.perpId));
  context.Position.set({
    id: positionId(p.accountId, p.perpId),
    accountId: p.accountId,
    perpId: p.perpId,
    positionTypeRaw: raw,
    side: side === "unknown" ? (prev?.side ?? "unknown") : side,
    lotLNS: p.endLotLNS,
    depositCNS: p.endDepositCNS,
    // Exchange-computed average entry is not in the event; keep the latest fill price and flag it in the UI.
    entryPricePNS: prev?.entryPricePNS ?? p.pricePNS,
    leverageHdths: p.leverageHdths,
    status: "open",
    realizedPnlCNS: prev?.realizedPnlCNS ?? 0n,
    updatedBlock: event.block.number,
  });
  recordEvent(context, event, p.accountId, "increase", { perpId: p.perpId, side, pricePNS: p.pricePNS, lotLNS: p.endLotLNS });
}

indexer.onEvent({ contract: "Exchange", event: "PositionIncreased" }, async ({ event, context }) =>
  onIncrease(context, event, event.params),
);
indexer.onEvent({ contract: "Exchange", event: "PositionIncreasedV2" }, async ({ event, context }) =>
  onIncrease(context, event, event.params),
);

indexer.onEvent({ contract: "Exchange", event: "PositionDecreased" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.accountId))) return;
  const prev = await context.Position.get(positionId(p.accountId, p.perpId));
  if (prev) {
    context.Position.set({
      ...prev,
      lotLNS: p.endLotLNS,
      depositCNS: p.endDepositCNS,
      realizedPnlCNS: prev.realizedPnlCNS + p.deltaPnlCNS + p.fundingCNS,
      updatedBlock: event.block.number,
    });
  }
  recordEvent(context, event, p.accountId, "decrease", { perpId: p.perpId, side: prev?.side as Side | undefined, lotLNS: p.endLotLNS, amountCNS: p.deltaPnlCNS, fundingCNS: p.fundingCNS });
});

indexer.onEvent({ contract: "Exchange", event: "PositionClosed" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.accountId))) return;
  const prev = await context.Position.get(positionId(p.accountId, p.perpId));
  if (prev) {
    context.Position.set({
      ...prev,
      lotLNS: 0n,
      depositCNS: 0n,
      status: "closed",
      realizedPnlCNS: prev.realizedPnlCNS + p.deltaPnlCNS + p.fundingCNS,
      updatedBlock: event.block.number,
    });
  }
  recordEvent(context, event, p.accountId, "close", { perpId: p.perpId, side: prev?.side as Side | undefined, pricePNS: p.pricePNS, amountCNS: p.deltaPnlCNS, fundingCNS: p.fundingCNS });
});

indexer.onEvent({ contract: "Exchange", event: "PositionInverted" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.accountId))) return;
  const prev = await context.Position.get(positionId(p.accountId, p.perpId));
  const raw = Number(p.positionType);
  // The event's positionType is assumed to be the NEW side; if the opening order is known it decides.
  let side = await resolveSide(context, event, p.accountId, p.perpId, raw);
  if (side === "unknown" && prev) side = flip(prev.side as Side);
  context.Position.set({
    id: positionId(p.accountId, p.perpId),
    accountId: p.accountId,
    perpId: p.perpId,
    positionTypeRaw: raw,
    side,
    lotLNS: p.endLotLNS,
    depositCNS: p.endDepositCNS,
    entryPricePNS: p.pricePNS,
    leverageHdths: p.leverageHdths,
    status: "open",
    realizedPnlCNS: (prev?.realizedPnlCNS ?? 0n) + p.deltaPnlCNS + p.fundingCNS,
    updatedBlock: event.block.number,
  });
  recordEvent(context, event, p.accountId, "invert", { perpId: p.perpId, side, pricePNS: p.pricePNS, lotLNS: p.endLotLNS, amountCNS: p.deltaPnlCNS, fundingCNS: p.fundingCNS });
});

indexer.onEvent({ contract: "Exchange", event: "PositionLiquidated" }, async ({ event, context }) => {
  const p = event.params;
  if (!(await tracked(context, p.posAccountId))) return;
  const prev = await context.Position.get(positionId(p.posAccountId, p.perpId));
  const remaining = p.posLotLNS > p.liqLotLNS ? p.posLotLNS - p.liqLotLNS : 0n;
  if (prev) {
    context.Position.set({
      ...prev,
      lotLNS: remaining,
      status: remaining === 0n ? "liquidated" : prev.status,
      realizedPnlCNS: prev.realizedPnlCNS + p.deltaPnlCNS + p.fundingCNS,
      updatedBlock: event.block.number,
    });
  }
  recordEvent(context, event, p.posAccountId, "liquidation", { perpId: p.perpId, side: prev?.side as Side | undefined, pricePNS: p.liqPricePNS, lotLNS: p.liqLotLNS, amountCNS: p.deltaPnlCNS, fundingCNS: p.fundingCNS });
});
