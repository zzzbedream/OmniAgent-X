// ERC-8004 (Trustless Agents) on Monad testnet: the guardian registers once as an agent (Identity
// Registry) and users rate each protective action (Reputation Registry), building a public track record.
// Addresses: erc-8004/erc-8004-contracts README (testnet set), bytecode present on 10143 and selectors
// checked against the implementations behind the proxies (2026-10-07). ABI from that repo's abis/*.json.
import { type Address, type Hex, keccak256, parseAbi, toBytes } from "viem";

export const ERC8004_TESTNET = {
  chainId: 10143,
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
} as const;

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

export type AgentCard = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string }[];
  registrations: { agentId: number; agentRegistry: string }[];
  supportedTrust: string[];
};

/** Registration file (agentURI target), registration-v1 shape from the ERC-8004 spec. */
export function buildAgentCard(args: { appUrl: string; workerUrl: string; agentId?: bigint }): AgentCard {
  const app = args.appUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "OmniAgent X Guardian",
    description:
      "Risk guardian for Perpl perpetuals on Monad. The owner signs a bounded mandate once (EIP-712, passkey); the " +
      "guardian may add collateral, reduce or close positions within it, and can never withdraw funds.",
    image: `${app}/logo.svg`,
    services: [
      { name: "web", endpoint: `${app}/guardian` },
      { name: "guardian-api", endpoint: args.workerUrl.replace(/\/$/, "") },
    ],
    registrations:
      args.agentId === undefined
        ? []
        : [{ agentId: Number(args.agentId), agentRegistry: `eip155:${ERC8004_TESTNET.chainId}:${ERC8004_TESTNET.identityRegistry}` }],
    supportedTrust: ["reputation"],
  };
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const EXPLORER_TX = "https://testnet.monadscan.com/tx/";

/**
 * giveFeedback arguments for one guardian action: +1 helpful, -1 not, tagged with the action type and
 * bound to the action's transaction (feedbackHash = keccak256 of the tx hash). The caller must not be
 * the agent's owner (ERC-8004), which holds because users rate and the operator owns the agent.
 */
export function guardianFeedback(args: {
  agentId: bigint;
  helpful: boolean;
  action: "addCollateral" | "reduce" | "close";
  txHash: Hex;
  workerUrl: string;
}): readonly [bigint, bigint, number, string, string, string, string, Hex] {
  if (!TX_HASH.test(args.txHash)) throw new Error("feedback needs a well-formed tx hash");
  return [
    args.agentId,
    args.helpful ? 1n : -1n,
    0,
    "guardian",
    args.action,
    args.workerUrl,
    `${EXPLORER_TX}${args.txHash}`,
    keccak256(toBytes(args.txHash)),
  ] as const;
}
