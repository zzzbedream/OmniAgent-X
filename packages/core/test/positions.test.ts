import { ContractFunctionExecutionError, ContractFunctionRevertedError, HttpRequestError, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { exchangeAbi } from "../src/perpl/abi";
import { isContractRevert, readPositions } from "../src/perpl/positions";

const revert = () =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: exchangeAbi, functionName: "getPosition", message: "PositionDoesNotExist" }),
    { abi: exchangeAbi, functionName: "getPosition", args: [32n, 1n] },
  );
const outage = () =>
  new ContractFunctionExecutionError(new HttpRequestError({ url: "https://rpc", status: 503 }), {
    abi: exchangeAbi,
    functionName: "getPosition",
    args: [32n, 1n],
  });

const info = (lot: bigint) => [
  { accountId: 1n, nextNodeId: 0n, prevNodeId: 0n, positionType: 1, depositCNS: 10n, pricePNS: 100n, lotLNS: lot, entryBlock: 5n, pnlCNS: 0n, deltaPnlCNS: 0n, premiumPnlCNS: 0n },
  100n,
  true,
];

function client(byPerp: Record<string, () => unknown>): PublicClient {
  return {
    readContract: async ({ args }: { args: [bigint, bigint] }) => {
      const r = byPerp[args[0].toString()]?.();
      if (r instanceof Error) throw r;
      return r ?? info(0n);
    },
  } as unknown as PublicClient;
}

describe("readPositions", () => {
  it("classifies reverts vs transport errors", () => {
    expect(isContractRevert(revert())).toBe(true);
    expect(isContractRevert(outage())).toBe(false);
    expect(isContractRevert(new Error("x"))).toBe(false);
  });
  it("skips markets that revert or have zero lots", async () => {
    const rows = await readPositions(client({ "32": () => info(7n), "16": () => revert() }), 1n);
    expect(rows.map(r => r.market)).toEqual(["ETH"]);
    expect(rows[0].lotLNS).toBe(7n);
  });
  it("propagates RPC outages instead of reporting an empty portfolio", async () => {
    await expect(readPositions(client({ "32": () => outage() }), 1n)).rejects.toBeInstanceOf(ContractFunctionExecutionError);
  });
});
