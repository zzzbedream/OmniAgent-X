import type { Address, PublicClient } from "viem";
import { delegatedAccountAbi, erc20Abi, exchangeAbi } from "./abi";
import type { MarketSymbol } from "./network";
import { PERPL_TESTNET } from "./network";
import type { PerpSnapshot } from "./orders";

export async function readCollateral(client: PublicClient, exchange: Address = PERPL_TESTNET.exchange) {
  const [, , , collateralDecimals, token] = await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getExchangeInfo",
  });
  const symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
  return { token, decimals: Number(collateralDecimals), symbol };
}

export async function readPerpSnapshot(client: PublicClient, market: MarketSymbol): Promise<PerpSnapshot> {
  const info = await client.readContract({
    address: PERPL_TESTNET.exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfo",
    args: [PERPL_TESTNET.markets[market]],
  });
  return {
    priceDecimals: info.priceDecimals,
    lotDecimals: info.lotDecimals,
    markPNS: info.markPNS,
    basePricePNS: info.basePricePNS,
    maxBidPriceONS: info.maxBidPriceONS,
    minAskPriceONS: info.minAskPriceONS,
  };
}

/** Everything the UI and the worker need to know about one DelegatedAccount. */
export async function readDelegatedAccount(client: PublicClient, account: Address, operator?: Address) {
  const [owner, accountId, collateralToken, isOperator] = await Promise.all([
    client.readContract({ address: account, abi: delegatedAccountAbi, functionName: "owner" }),
    client.readContract({ address: account, abi: delegatedAccountAbi, functionName: "accountId" }),
    client.readContract({ address: account, abi: delegatedAccountAbi, functionName: "collateralToken" }),
    operator
      ? client.readContract({ address: account, abi: delegatedAccountAbi, functionName: "isOperator", args: [operator] })
      : Promise.resolve(undefined),
  ]);
  const exchangeAccount =
    accountId > 0n
      ? await client.readContract({
          address: PERPL_TESTNET.exchange,
          abi: exchangeAbi,
          functionName: "getAccountById",
          args: [accountId],
        })
      : undefined;
  return {
    owner,
    accountId,
    collateralToken,
    isOperator,
    balanceCNS: exchangeAccount?.balanceCNS ?? 0n,
    lockedBalanceCNS: exchangeAccount?.lockedBalanceCNS ?? 0n,
  };
}
