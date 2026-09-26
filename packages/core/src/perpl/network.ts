// Perpl on Monad testnet. Sources: PerplFoundation/delegated-account README (Factory, Exchange)
// and PerplFoundation/api-docs README (market ids). See docs/VERIFIED_FACTS.md.
//
// The collateral token is deliberately NOT hard-coded: api-docs lists 0xdf5b…c027 ("USD") while the
// delegated-account fork test uses 0xa9012a…22dC ("AUSD, 6 decimals"). Read it on-chain with
// Exchange.getExchangeInfo() (see readCollateral in ./reads.ts).
import type { Address } from "viem";

export const PERPL_TESTNET = {
  chainId: 10143,
  factory: "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209" as Address,
  exchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc" as Address,
  markets: { BTC: 16n, ETH: 32n, SOL: 48n, MON: 64n } as const,
} as const;

export type MarketSymbol = keyof typeof PERPL_TESTNET.markets;
export const MARKET_SYMBOLS = Object.keys(PERPL_TESTNET.markets) as MarketSymbol[];

export const FACTORY_EIP712_DOMAIN = {
  name: "DelegatedAccountFactory",
  version: "1",
  chainId: PERPL_TESTNET.chainId,
  verifyingContract: PERPL_TESTNET.factory,
} as const;

export const ASSIGN_OPERATOR_TYPES = {
  AssignOperator: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
