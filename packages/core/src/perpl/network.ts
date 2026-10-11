// Perpl on Monad testnet. Sources: PerplFoundation/delegated-account README (Factory, Exchange)
// and PerplFoundation/api-docs README (market ids). See docs/VERIFIED_FACTS.md.
//
// The collateral token is deliberately NOT hard-coded; read it on-chain with Exchange.getExchangeInfo()
// (readCollateral in ./reads.ts). On 2026-10-01 that returned Agora's AUSD 0xa9012a…22dC (6 decimals),
// which settled the api-docs (0xdf5b…c027 "USD") vs fork-test disagreement in favour of AUSD.
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

/**
 * Agora's AUSD faucet on Monad testnet (docs.agora.finance contract deployments), an upgradeable proxy.
 * requestFunds(recipient) is in the implementation (0xba80…2a49); drips were verified on-chain by the gas station.
 */
export const AGORA_AUSD_FAUCET_TESTNET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;
// The faucet's limit is global, not per address (read on-chain 2026-10-11): one drip of faucetDripAmount (10,000
// AUSD) every maxDripFrequency seconds (60) for everyone on testnet, and only to recipients holding less than
// maxAmountToOwn (100,000 AUSD). A drip inside the window reverts with MaxFrequencyExceeded().
export const ausdFaucetAbi = [
  {
    type: "function",
    name: "requestFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [],
  },
  { type: "function", name: "lastDripTimestamp", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDripFrequency", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "faucetDripAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "error", name: "MaxFrequencyExceeded", inputs: [] },
] as const;

/** Perpl testnet minimums from /v1/pub/context (2026-10-01), in AUSD: opening an account, later deposits. */
export const PERPL_TESTNET_MIN_OPEN_AUSD = 100;
export const PERPL_TESTNET_MIN_DEPOSIT_AUSD = 10;
