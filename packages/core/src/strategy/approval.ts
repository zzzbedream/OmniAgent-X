// User approval of a plan: an EIP-712 signature by the account owner (the Mera passkey account).
// The worker executes only plans whose hash, owner, account, budget, nonce and deadline match the signature.
import { type Address, type Hex, keccak256, toBytes } from "viem";
import type { TradePlan } from "./schema";

export const APPROVAL_DOMAIN = (chainId: number) => ({ name: "OmniAgentX", version: "1", chainId }) as const;

export const PLAN_APPROVAL_TYPES = {
  PlanApproval: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "planHash", type: "bytes32" },
    { name: "budgetMicroUsd", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type PlanApprovalMessage = {
  owner: Address;
  account: Address;
  planHash: Hex;
  budgetMicroUsd: bigint;
  nonce: bigint;
  deadline: bigint;
};

/** Hash only what executes (the orders), in a fixed field order, so free-text changes cannot alter it. */
export function hashPlanOrders(plan: Pick<TradePlan, "orders">): Hex {
  const canonical = plan.orders.map(o => [o.market, o.side, o.notionalUsd, o.leverage]);
  return keccak256(toBytes(JSON.stringify(canonical)));
}

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

/** Owner approval to close one position (the worker's endpoints are public; closing must be authorised). */
export const CLOSE_APPROVAL_TYPES = {
  ClosePosition: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "perpId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type CloseApprovalMessage = {
  owner: Address;
  account: Address;
  perpId: bigint;
  nonce: bigint;
  deadline: bigint;
};

/** Owner proof before the worker signs an operator consent for them (stops anonymous consent farming). */
export const CONSENT_REQUEST_TYPES = {
  ConsentRequest: [
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
