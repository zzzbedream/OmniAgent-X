import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { readDelegatedAccount } from "../src/perpl/reads";

const ACCOUNT = "0x00000000000000000000000000000000000000Aa".toLowerCase() as `0x${string}`;

function fakeClient(accountAddr: string): PublicClient {
  const answers: Record<string, unknown> = {
    owner: "0x00000000000000000000000000000000000000bb",
    accountId: 5n,
    collateralToken: "0x00000000000000000000000000000000000000cc",
    getAccountById: { balanceCNS: 1n, lockedBalanceCNS: 0n, accountAddr },
  };
  return { readContract: async ({ functionName }: { functionName: string }) => answers[functionName] } as unknown as PublicClient;
}

describe("readDelegatedAccount", () => {
  it("accepts an exchange account recorded for this contract", async () => {
    expect((await readDelegatedAccount(fakeClient(ACCOUNT), ACCOUNT)).ownsExchangeAccount).toBe(true);
  });

  it("flags a contract that points at someone else's exchange account", async () => {
    const acc = await readDelegatedAccount(fakeClient("0x00000000000000000000000000000000000000dd"), ACCOUNT);
    expect(acc.ownsExchangeAccount).toBe(false);
  });
});
