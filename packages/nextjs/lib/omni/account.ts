// Which trading account (Perpl DelegatedAccount) belongs to a passkey owner.
// The browser that created it remembers it; any other browser asks the worker's on-chain index of factory events.
import { delegatedAccountAbi } from "@omniagent/core";
import type { Address } from "viem";
import { loadDelegatedAccount, saveDelegatedAccount, worker } from "~~/lib/omni/worker";
import { publicClient } from "~~/services/mera/MeraProvider";

export type ResolvedAccount = { address: Address; source: "browser" | "chain" };

/**
 * The owner's DelegatedAccount: the one this browser saved, else the newest one the owner created with our
 * operator that already has an exchange account (an empty, never-funded duplicate is skipped). Undefined if none.
 */
export async function resolveDelegatedAccount(owner: Address): Promise<ResolvedAccount | undefined> {
  const saved = loadDelegatedAccount(owner);
  if (saved) return { address: saved, source: "browser" };
  let accounts: Address[];
  try {
    accounts = (await worker.accounts(owner)).accounts;
  } catch {
    return undefined; // index off or worker unreachable: the page offers to create or paste an account
  }
  if (accounts.length === 0) return undefined;
  const ids = await Promise.all(
    accounts.map(a =>
      publicClient.readContract({ address: a, abi: delegatedAccountAbi, functionName: "accountId" }).catch(() => 0n),
    ),
  );
  const address = accounts[ids.findIndex(id => id > 0n)] ?? accounts[0]!;
  saveDelegatedAccount(owner, address);
  return { address, source: "chain" };
}
