// Building Perpl on-chain OrderDesc structs.
//
// Verified from PerplFoundation/delegated-account test/DelegatedAccount.fork.t.sol:
// - the ON-CHAIN enum starts at OpenLong = 0. The REST/WebSocket OrderType enum starts at OpenLong = 1,
//   so the two must never be mixed;
// - prices are absolute PNS (price scaled by priceDecimals); book prices are ONS offsets from basePricePNS;
// - lots are LNS (size scaled by lotDecimals); leverage is in hundredths (100 = 1x);
// - a resting order uses orderDescId 0, expiryBlock = block + N, lastExecutionBlock 0.
//
// NOT verified: how the exchange treats an IOC order priced away from the book (fill/cancel/revert),
// minimum lot sizes, and how expiryBlock interacts with IOC. The worker runs in dry-run by default until
// these are checked on testnet (scripts/spikes/perpl-s2.mts, post-only test order).
import type { MarketSymbol } from "./network";
import { PERPL_TESTNET } from "./network";

export const OrderDescType = {
  OpenLong: 0,
  OpenShort: 1,
  CloseLong: 2,
  CloseShort: 3,
  Cancel: 4,
  IncreasePositionCollateral: 5,
  Change: 6,
} as const;

export type OrderDesc = {
  orderDescId: bigint;
  perpId: bigint;
  orderType: number;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
  maxNegPnlCollatBPS: bigint;
};

/** The subset of Exchange.getPerpetualInfo() the builder needs. */
export type PerpSnapshot = {
  priceDecimals: bigint;
  lotDecimals: bigint;
  markPNS: bigint;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
};

export type OpenOrderIntent = {
  market: MarketSymbol;
  side: "long" | "short";
  notionalUsd: number;
  leverage: number;
};

export class OrderBuildError extends Error {}

const BPS = 10_000n;
const USD_MICRO = 1_000_000n;

function toMicroUsd(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) throw new OrderBuildError(`invalid notional ${usd}`);
  return BigInt(Math.round(usd * 1_000_000));
}

/** Position size in LNS for a USD notional at the mark price, rounded down. */
export function notionalToLots(notionalUsd: number, perp: PerpSnapshot): bigint {
  if (perp.markPNS <= 0n) throw new OrderBuildError("mark price unavailable");
  // lots = notional / (markPNS / 10^pd) * 10^ld
  const lots = (toMicroUsd(notionalUsd) * 10n ** (perp.lotDecimals + perp.priceDecimals)) / (perp.markPNS * USD_MICRO);
  if (lots === 0n) throw new OrderBuildError(`notional ${notionalUsd} USD is below one lot`);
  return lots;
}

/**
 * Immediate-or-cancel limit order that opens a position, priced at mark ± slippage.
 * A long may pay up to mark·(1+s); a short accepts down to mark·(1−s).
 */
export function buildOpenIocOrder(
  intent: OpenOrderIntent,
  perp: PerpSnapshot,
  opts: { slippageBps: number; currentBlock: bigint; ttlBlocks?: bigint },
): OrderDesc {
  if (!Number.isInteger(opts.slippageBps) || opts.slippageBps < 0 || opts.slippageBps > 1000) {
    throw new OrderBuildError(`slippageBps out of range: ${opts.slippageBps}`);
  }
  const leverageHdths = BigInt(Math.round(intent.leverage * 100));
  if (leverageHdths < 100n) throw new OrderBuildError(`leverage below 1x: ${intent.leverage}`);
  const slip = BigInt(opts.slippageBps);
  const pricePNS =
    intent.side === "long" ? (perp.markPNS * (BPS + slip)) / BPS : (perp.markPNS * (BPS - slip)) / BPS;
  return {
    orderDescId: 0n,
    perpId: PERPL_TESTNET.markets[intent.market],
    orderType: intent.side === "long" ? OrderDescType.OpenLong : OrderDescType.OpenShort,
    orderId: 0n,
    pricePNS,
    lotLNS: notionalToLots(intent.notionalUsd, perp),
    expiryBlock: opts.currentBlock + (opts.ttlBlocks ?? 100n),
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: 0n,
  };
}

/**
 * Post-only bid one price unit (1 USD) below the best bid, mirroring Perpl's own fork test.
 * It cannot cross the spread, so it rests on the book; used only to validate the encoding.
 */
export function buildPostOnlyTestBid(
  market: MarketSymbol,
  perp: PerpSnapshot,
  lotLNS: bigint,
  currentBlock: bigint,
): OrderDesc {
  if (perp.maxBidPriceONS === 0n) throw new OrderBuildError("no bids on the book; cannot place a safe test bid");
  const bestBidPNS = perp.basePricePNS + perp.maxBidPriceONS;
  const oneUsd = 10n ** perp.priceDecimals;
  if (bestBidPNS <= oneUsd) throw new OrderBuildError("best bid too low for a test bid");
  return {
    orderDescId: 0n,
    perpId: PERPL_TESTNET.markets[market],
    orderType: OrderDescType.OpenLong,
    orderId: 0n,
    pricePNS: bestBidPNS - oneUsd,
    lotLNS,
    expiryBlock: currentBlock + 1000n,
    postOnly: true,
    fillOrKill: false,
    immediateOrCancel: false,
    maxMatches: 0n,
    leverageHdths: 100n,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: 0n,
  };
}

/**
 * Immediate-or-cancel order that closes an existing position in full.
 * Closing a long sells (accept down to mark·(1−s)); closing a short buys (pay up to mark·(1+s)).
 * The side must come from a verified source (the order that opened it), never from the raw PositionEnum.
 *
 * NOT verified on testnet: whether Close orders honour leverageHdths/expiryBlock the same way as opens.
 */
export function buildCloseIocOrder(
  side: "long" | "short",
  market: MarketSymbol,
  lotLNS: bigint,
  perp: PerpSnapshot,
  opts: { slippageBps: number; currentBlock: bigint; ttlBlocks?: bigint },
): OrderDesc {
  if (lotLNS <= 0n) throw new OrderBuildError("nothing to close");
  if (perp.markPNS <= 0n) throw new OrderBuildError("mark price unavailable");
  if (!Number.isInteger(opts.slippageBps) || opts.slippageBps < 0 || opts.slippageBps > 1000) {
    throw new OrderBuildError(`slippageBps out of range: ${opts.slippageBps}`);
  }
  const slip = BigInt(opts.slippageBps);
  const pricePNS = side === "long" ? (perp.markPNS * (BPS - slip)) / BPS : (perp.markPNS * (BPS + slip)) / BPS;
  return {
    orderDescId: 0n,
    perpId: PERPL_TESTNET.markets[market],
    orderType: side === "long" ? OrderDescType.CloseLong : OrderDescType.CloseShort,
    orderId: 0n,
    pricePNS,
    lotLNS,
    expiryBlock: opts.currentBlock + (opts.ttlBlocks ?? 100n),
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths: 100n,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: 0n,
  };
}

/** Side implied by an on-chain order type we sent (verified OrderDescEnum), for open orders only. */
export function sideOfOpenOrderType(orderType: number): "long" | "short" | undefined {
  if (orderType === OrderDescType.OpenLong) return "long";
  if (orderType === OrderDescType.OpenShort) return "short";
  return undefined;
}
