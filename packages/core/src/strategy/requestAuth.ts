// Authentication for the paid planning endpoint (/api/strategy).
// The caller signs PlanRequest with the Mera owner key; the signature is bound to the exact request text and
// budget (requestHash) and expires quickly. The route then checks on-chain that the signer owns a funded
// DelegatedAccount operated by our worker, which makes anonymous budget-draining expensive.
import { type Address, type Hex, getAddress, isAddress, keccak256, recoverTypedDataAddress, toBytes } from "viem";
import { z } from "zod";
import { APPROVAL_DOMAIN } from "./approval";

export const PLAN_REQUEST_TYPES = {
  PlanRequest: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "requestHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const MAX_PLAN_REQUEST_TTL_SEC = 300n;

export function planRequestHash(request: string, budgetUsd: number): Hex {
  return keccak256(toBytes(JSON.stringify([request.trim(), budgetUsd])));
}

const AuthSchema = z.object({
  owner: z.string().refine(isAddress, "invalid address"),
  account: z.string().refine(isAddress, "invalid address"),
  deadline: z.string().regex(/^\d+$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "expected 65-byte hex signature"),
});

export class RequestAuthError extends Error {}

export async function verifyPlanRequest(
  auth: unknown,
  request: string,
  budgetUsd: number,
  opts: { chainId: number; nowSec: bigint },
): Promise<{ owner: Address; account: Address }> {
  const parsed = AuthSchema.safeParse(auth);
  if (!parsed.success) throw new RequestAuthError("missing or malformed auth");
  const deadline = BigInt(parsed.data.deadline);
  if (deadline <= opts.nowSec) throw new RequestAuthError("auth expired");
  if (deadline > opts.nowSec + MAX_PLAN_REQUEST_TTL_SEC) throw new RequestAuthError("auth deadline too far in the future");
  const owner = getAddress(parsed.data.owner);
  const account = getAddress(parsed.data.account);
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: APPROVAL_DOMAIN(opts.chainId),
      types: PLAN_REQUEST_TYPES,
      primaryType: "PlanRequest",
      message: { owner, account, requestHash: planRequestHash(request, budgetUsd), deadline },
      signature: parsed.data.signature as Hex,
    });
  } catch {
    throw new RequestAuthError("signature could not be recovered");
  }
  if (signer !== owner) throw new RequestAuthError("auth not signed by the owner (or request altered)");
  return { owner, account };
}

/** Per-key daily counter (in memory, per process). */
export class DailyQuota {
  private day = "";
  private readonly counts = new Map<string, number>();

  constructor(private readonly today: () => string = () => new Date().toISOString().slice(0, 10)) {}

  take(key: string, limit: number): boolean {
    const d = this.today();
    if (d !== this.day) {
      this.day = d;
      this.counts.clear();
    }
    const n = this.counts.get(key) ?? 0;
    if (n >= limit) return false;
    this.counts.set(key, n + 1);
    return true;
  }
}
