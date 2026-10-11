// Server-only helpers shared by the paid LLM routes (/api/strategy, /api/guardian/compile).
// Never import this from a client component: it reads server env vars.
import { readDelegatedAccount } from "@omniagent/core";
import { type Address, createPublicClient, getAddress, http, isAddress } from "viem";
import { monadTestnet } from "viem/chains";

export const serverClient = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_TESTNET_RPC || undefined),
});

/** When set, only accounts operated by our worker may spend LLM calls. */
export const expectedOperator =
  process.env.WORKER_OPERATOR_ADDRESS && isAddress(process.env.WORKER_OPERATOR_ADDRESS)
    ? getAddress(process.env.WORKER_OPERATOR_ADDRESS)
    : undefined;

/**
 * The signer must own a DelegatedAccount whose exchange account is its own (and have our worker as operator
 * when configured). Opening that exchange account costs gas plus the 100 AUSD minimum. On testnet AUSD comes
 * from a faucet, so the per-owner and global quotas are the real limit on LLM spend.
 * Throws with a user-facing message when the account is not eligible.
 */
export async function assertEligibleAccount(caller: { owner: Address; account: Address }): Promise<void> {
  const acc = await readDelegatedAccount(serverClient, caller.account, expectedOperator);
  if (acc.owner !== caller.owner) throw new Error("signer does not own this DelegatedAccount");
  if (acc.accountId === 0n)
    throw new Error(
      "your trading account has no funds on the exchange yet: deposit at least 100 AUSD in Account first",
    );
  if (!acc.ownsExchangeAccount) throw new Error("the exchange account does not belong to this DelegatedAccount");
  if (expectedOperator && !acc.isOperator) throw new Error("this app's agent is not an operator of the account");
}

export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
