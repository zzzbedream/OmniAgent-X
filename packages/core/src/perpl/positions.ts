import type { PublicClient } from "viem";
import { exchangeAbi } from "./abi";
import { MARKET_SYMBOLS, type MarketSymbol, PERPL_TESTNET } from "./network";

export type OnChainPosition = {
  market: MarketSymbol;
  perpId: bigint;
  /** Raw on-chain PositionEnum. Its meaning is NOT documented; resolve it with the indexer's calibration. */
  positionTypeRaw: number;
  depositCNS: bigint;
  /** PositionInfo.pricePNS, read as the entry price. */
  entryPricePNS: bigint;
  lotLNS: bigint;
  entryBlock: bigint;
  pnlCNS: bigint;
  markPricePNS: bigint;
  markPriceValid: boolean;
};

/** Open positions of an exchange account across the known markets (lotLNS > 0). */
export async function readPositions(client: PublicClient, accountId: bigint): Promise<OnChainPosition[]> {
  const rows = await Promise.all(
    MARKET_SYMBOLS.map(async (market): Promise<OnChainPosition | undefined> => {
      const perpId: bigint = PERPL_TESTNET.markets[market];
      try {
        const [info, markPricePNS, markPriceValid] = await client.readContract({
          address: PERPL_TESTNET.exchange,
          abi: exchangeAbi,
          functionName: "getPosition",
          args: [perpId, accountId],
        });
        return {
          market,
          perpId,
          positionTypeRaw: Number(info.positionType),
          depositCNS: info.depositCNS,
          entryPricePNS: info.pricePNS,
          lotLNS: info.lotLNS,
          entryBlock: info.entryBlock,
          pnlCNS: info.pnlCNS,
          markPricePNS,
          markPriceValid,
        };
      } catch {
        // Behaviour for a market without a position (empty struct vs revert) is not documented.
        return undefined;
      }
    }),
  );
  return rows.filter((r): r is OnChainPosition => !!r && r.lotLNS > 0n);
}
