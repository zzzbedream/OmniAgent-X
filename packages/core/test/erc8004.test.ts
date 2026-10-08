import { keccak256, toBytes, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  ERC8004_TESTNET,
  buildAgentCard,
  guardianFeedback,
  identityRegistryAbi,
  reputationRegistryAbi,
} from "../src/erc8004/registry";

const fn = (abi: readonly { type: string; name?: string }[], name: string) =>
  abi.find(x => x.type === "function" && x.name === name) as Parameters<typeof toFunctionSelector>[0];

describe("ERC-8004 ABI", () => {
  // Selectors found in the implementation bytecode behind the Monad testnet proxies (2026-10-07).
  it("matches the deployed registries", () => {
    expect(toFunctionSelector(fn(identityRegistryAbi, "register"))).toBe("0xf2c298be");
    expect(toFunctionSelector(fn(identityRegistryAbi, "setAgentURI"))).toBe("0x0af28bd3");
    expect(toFunctionSelector(fn(reputationRegistryAbi, "giveFeedback"))).toBe("0x3c036a7e");
  });
});

describe("buildAgentCard", () => {
  it("follows the registration-v1 shape and links the registry in CAIP-10 style", () => {
    const card = buildAgentCard({ appUrl: "https://omni.example", workerUrl: "https://worker.example", agentId: 42n });
    expect(card).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "OmniAgent X Guardian",
      image: "https://omni.example/logo.svg",
      registrations: [{ agentId: 42, agentRegistry: `eip155:10143:${ERC8004_TESTNET.identityRegistry}` }],
      supportedTrust: ["reputation"],
    });
    expect(card.services.map(s => s.name)).toEqual(["web", "guardian-api"]);
  });

  it("omits registrations before the agent is registered", () => {
    expect(buildAgentCard({ appUrl: "https://omni.example", workerUrl: "https://w.example" }).registrations).toEqual([]);
  });
});

describe("guardianFeedback", () => {
  const tx = `0x${"ab".repeat(32)}` as const;

  it("ties the feedback to the guardian transaction", () => {
    const args = guardianFeedback({ agentId: 7n, helpful: true, action: "reduce", txHash: tx, workerUrl: "https://w.example" });
    expect(args).toEqual([
      7n,
      1n,
      0,
      "guardian",
      "reduce",
      "https://w.example",
      `https://testnet.monadscan.com/tx/${tx}`,
      keccak256(toBytes(tx)),
    ]);
  });

  it("scores unhelpful actions -1 and rejects a malformed tx hash", () => {
    expect(guardianFeedback({ agentId: 7n, helpful: false, action: "close", txHash: tx, workerUrl: "" })[1]).toBe(-1n);
    expect(() =>
      guardianFeedback({ agentId: 7n, helpful: true, action: "close", txHash: "0x123" as `0x${string}`, workerUrl: "" }),
    ).toThrow(/tx hash/);
  });
});
