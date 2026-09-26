// On-chain checks and order execution through the Perpl DelegatedAccount.
// The operator calls the DelegatedAccount with Exchange.execOrder calldata; its fallback forwards the
// call to the Exchange only for allow-listed selectors (execOrder is on the default allowlist).
import {
  EXEC_ORDER_SELECTOR,
  type OrderDesc,
  buildCloseIocOrder,
  buildOpenIocOrder,
  delegatedAccountAbi,
  exchangeAbi,
  readCollateral,
  readDelegatedAccount,
  readPerpSnapshot,
  readPositions,
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
import { MARKET_BY_PERP, ValidationError, type ValidatedClose, type ValidatedPlan } from "./validate";

export type ExecutionResult = {
  mode: "dry-run" | "live";
  status: "built" | "sent" | "partial" | "failed";
  orders: { order: OrderDesc; calldata: Hex; txHash?: Hex; error?: string }[];
};

/** Owner, operator, exchange account and execOrder allowlist checks shared by opens and closes. */
export async function checkAccountAccess(client: PublicClient, owner: Address, account: Address, operator: Address) {
  const acc = await readDelegatedAccount(client, account, operator);
  if (acc.owner !== owner) throw new ValidationError("approval owner is not the DelegatedAccount owner");
  if (!acc.isOperator) throw new ValidationError("this worker is not an operator of the account");
  if (acc.accountId === 0n) throw new ValidationError("DelegatedAccount has no exchange account yet (createAccount)");
  // Accounts minted by the testnet factory start with a stale allowlist (see core/perpl/allowlist.ts).
  const canExec = await client.readContract({
    address: account,
    abi: delegatedAccountAbi,
    functionName: "operatorAllowlist",
    args: [EXEC_ORDER_SELECTOR],
  });
  if (!canExec) throw new ValidationError("operator is not allowed to call execOrder: repair the allowlist in Cuenta");
  return acc;
}

export async function checkAccountOnChain(client: PublicClient, v: ValidatedPlan, operator: Address) {
  const acc = await checkAccountAccess(client, v.message.owner, v.message.account, operator);
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


/** Envio calibration fallback: raw PositionEnum → side, only when every observation agrees. */
async function sideFromIndexer(indexerUrl: string, positionTypeRaw: number): Promise<"long" | "short" | undefined> {
  try {
    const res = await fetch(indexerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ SideCalibration { id longCount shortCount } }" }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { data?: { SideCalibration?: { id: string; longCount: number; shortCount: number }[] } };
    const c = body.data?.SideCalibration?.find(x => x.id === String(positionTypeRaw));
    if (!c) return undefined;
    if (c.longCount > 0 && c.shortCount === 0) return "long";
    if (c.shortCount > 0 && c.longCount === 0) return "short";
    return undefined;
  } catch {
    return undefined;
  }
}

export type CloseResult = {
  mode: "dry-run" | "live";
  status: "built" | "sent" | "failed";
  side: "long" | "short";
  sideSource: "worker-log" | "indexer";
  order: OrderDesc;
  calldata: Hex;
  txHash?: Hex;
  error?: string;
};

export async function executeClose(args: {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  close: ValidatedClose;
  slippageBps: number;
  live: boolean;
  sideFromLog: (account: Address, perpId: bigint) => "long" | "short" | undefined;
  indexerUrl?: string;
}): Promise<CloseResult> {
  const { client, wallet, close, slippageBps, live } = args;
  const { owner, account, perpId } = close.message;
  const market = MARKET_BY_PERP.get(perpId);
  if (!market) throw new ValidationError(`unknown perpId ${perpId}`);
  const acc = await checkAccountAccess(client, owner, account, wallet.account.address);

  const position = (await readPositions(client, acc.accountId)).find(p => p.perpId === perpId);
  if (!position) throw new ValidationError(`no open position on ${market}`);

  let side = args.sideFromLog(account, perpId);
  let sideSource: CloseResult["sideSource"] = "worker-log";
  if (!side && args.indexerUrl) {
    side = await sideFromIndexer(args.indexerUrl, position.positionTypeRaw);
    sideSource = "indexer";
  }
  if (!side) {
    throw new ValidationError(
      `side of the ${market} position is unknown: it was not opened by this worker and no indexer calibration exists`,
      { positionTypeRaw: position.positionTypeRaw },
    );
  }

  const perp = await readPerpSnapshot(client, market);
  const order = buildCloseIocOrder(side, market, position.lotLNS, perp, {
    slippageBps,
    currentBlock: await client.getBlockNumber(),
  });
  const calldata = encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [order] });
  if (!live) return { mode: "dry-run", status: "built", side, sideSource, order, calldata };

  try {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: account,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [order],
    });
    const txHash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`reverted in tx ${txHash}`);
    return { mode: "live", status: "sent", side, sideSource, order, calldata, txHash };
  } catch (e) {
    return { mode: "live", status: "failed", side, sideSource, order, calldata, error: (e as Error).message.slice(0, 500) };
  }
}
