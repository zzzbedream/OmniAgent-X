// Off-chain checks on an approved plan. Pure (no network) so they are unit-testable.
// On-chain checks (owner, operator, balance) happen in executor.ts.
import {
  APPROVAL_DOMAIN,
  PLAN_APPROVAL_TYPES,
  type PlanApprovalMessage,
  type RiskReport,
  type TradePlan,
  TradePlanSchema,
  evaluatePlan,
  hashPlanOrders,
  usdToMicro,
} from "@omniagent/core";
import { type Address, type Hex, getAddress, isAddress, isHex, recoverTypedDataAddress } from "viem";
import { z } from "zod";

const addr = z.string().refine(isAddress, "invalid address");
const hex = z.string().refine(v => isHex(v), "invalid hex");
const uintString = z.string().regex(/^\d+$/, "expected a decimal integer string");

/** Wire format: bigints travel as decimal strings. */
export const SubmitPlanSchema = z.object({
  plan: TradePlanSchema,
  budgetUsd: z.number().positive(),
  approval: z.object({
    message: z.object({
      owner: addr,
      account: addr,
      planHash: hex,
      budgetMicroUsd: uintString,
      nonce: uintString,
      deadline: uintString,
    }),
    signature: hex,
  }),
});
export type SubmitPlanRequest = z.infer<typeof SubmitPlanSchema>;

export type ValidatedPlan = {
  plan: TradePlan;
  budgetUsd: number;
  risk: RiskReport;
  message: PlanApprovalMessage;
  signature: Hex;
};

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function validateSubmission(
  body: unknown,
  opts: { chainId: number; nowSec: bigint; isNonceUsed: (owner: Address, nonce: bigint) => boolean },
): Promise<ValidatedPlan> {
  const parsed = SubmitPlanSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("malformed request", parsed.error.issues);
  const { plan, budgetUsd, approval } = parsed.data;

  const risk = evaluatePlan(plan, budgetUsd);
  if (!risk.ok) throw new ValidationError("plan violates risk policy", risk.violations);

  const message: PlanApprovalMessage = {
    owner: getAddress(approval.message.owner),
    account: getAddress(approval.message.account),
    planHash: approval.message.planHash as Hex,
    budgetMicroUsd: BigInt(approval.message.budgetMicroUsd),
    nonce: BigInt(approval.message.nonce),
    deadline: BigInt(approval.message.deadline),
  };
  if (message.planHash !== hashPlanOrders(plan)) throw new ValidationError("planHash does not match the orders");
  if (message.budgetMicroUsd !== usdToMicro(budgetUsd)) throw new ValidationError("budget does not match approval");
  if (message.deadline <= opts.nowSec) throw new ValidationError("approval expired");
  if (opts.isNonceUsed(message.owner, message.nonce)) throw new ValidationError("approval nonce already used");

  const signer = await recoverTypedDataAddress({
    domain: APPROVAL_DOMAIN(opts.chainId),
    types: PLAN_APPROVAL_TYPES,
    primaryType: "PlanApproval",
    message,
    signature: approval.signature as Hex,
  });
  if (signer !== message.owner) throw new ValidationError("signature is not from the owner");

  return { plan, budgetUsd, risk, message, signature: approval.signature as Hex };
}
