// On-chain checks and order execution through the Perpl DelegatedAccount.
// The operator calls the DelegatedAccount with Exchange.execOrder calldata; its fallback forwards the
// call to the Exchange only for allow-listed selectors (execOrder is on the default allowlist).
import {
  EXEC_ORDER_SELECTOR,
  type OrderDesc,
  buildOpenIocOrder,
  delegatedAccountAbi,
  exchangeAbi,
  readCollateral,
  readDelegatedAccount,
  readPerpSnapshot,
} from "@omniagent/core";
import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  encodeFunctionData,
} from "viem";
import { ValidationError, type ValidatedPlan } from "./validate";

export type ExecutionResult = {
  mode: "dry-run" | "live";
  status: "built" | "sent" | "partial" | "failed";
  orders: { order: OrderDesc; calldata: Hex; txHash?: Hex; error?: string }[];
};

export async function checkAccountOnChain(client: PublicClient, v: ValidatedPlan, operator: Address) {
  const acc = await readDelegatedAccount(client, v.message.account, operator);
  if (acc.owner !== v.message.owner) throw new ValidationError("approval owner is not the DelegatedAccount owner");
  if (!acc.isOperator) throw new ValidationError("this worker is not an operator of the account");
  if (acc.accountId === 0n) throw new ValidationError("DelegatedAccount has no exchange account yet (createAccount)");
  // Accounts minted by the testnet factory start with a stale allowlist (see core/perpl/allowlist.ts).
  const canExec = await client.readContract({
    address: v.message.account,
    abi: delegatedAccountAbi,
    functionName: "operatorAllowlist",
    args: [EXEC_ORDER_SELECTOR],
  });
  if (!canExec) throw new ValidationError("operator is not allowed to call execOrder: repair the allowlist in Cuenta");
  const collateral = await readCollateral(client);
  // Approximation: free balance = balance − locked. The Exchange performs the authoritative margin check.
  const free = acc.balanceCNS - acc.lockedBalanceCNS;
  const needed = BigInt(Math.ceil(v.risk.requiredMarginUsd * 10 ** collateral.decimals));
  if (needed > free) {
    throw new ValidationError("insufficient free collateral on the exchange account", {
      neededCNS: needed.toString(),
      freeCNS: free.toString(),
      token: collateral.symbol,
    });
  }
  return acc;
}

export async function executePlan(args: {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  plan: ValidatedPlan;
  slippageBps: number;
  live: boolean;
}): Promise<ExecutionResult> {
  const { client, wallet, plan, slippageBps, live } = args;
  const currentBlock = await client.getBlockNumber();
  const built = await Promise.all(
    plan.plan.orders.map(async o => {
      const perp = await readPerpSnapshot(client, o.market);
      const order = buildOpenIocOrder(o, perp, { slippageBps, currentBlock });
      const calldata = encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [order] });
      return { order, calldata };
    }),
  );
  if (!live) return { mode: "dry-run", status: "built", orders: built };

  const results: ExecutionResult["orders"] = [];
  for (const b of built) {
    try {
      // Target is the DelegatedAccount, not the Exchange: its fallback forwards allow-listed calls.
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: plan.message.account,
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [b.order],
      });
      const txHash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`reverted in tx ${txHash}`);
      results.push({ ...b, txHash });
    } catch (e) {
      results.push({ ...b, error: (e as Error).message.slice(0, 500) });
      // Stop on the first failure: later orders were sized assuming the earlier ones succeed.
      break;
    }
  }
  const sent = results.filter(r => r.txHash).length;
  const status = sent === built.length ? "sent" : sent === 0 ? "failed" : "partial";
  return { mode: "live", status, orders: results };
}

