// HTTP-shaped handler for the guardian compiler (Next route /api/guardian/compile). Framework-free and
// with injected I/O so every status path is unit-tested. Order matters: nothing paid (the LLM call) runs
// before the signature, the on-chain eligibility check and the quota have passed.
import type { Address } from "viem";
import { z } from "zod";
import { type LlmConfig, LlmError } from "../strategy/llm";
import { RequestAuthError, guardianRequestHash, verifySignedRequest } from "../strategy/requestAuth";
import { compileMandate } from "./compile";

const BodySchema = z.object({ text: z.string().trim().min(5).max(1000), auth: z.unknown() });

export type CompileRequestDeps = {
  llm: LlmConfig | null;
  /** Env vars missing when llm is null, reported in the 503. */
  missing: string[];
  chainId: number;
  nowSec: bigint;
  /** Throws with a user-facing message when the caller may not spend LLM calls. */
  assertEligible: (caller: { owner: Address; account: Address }) => Promise<void>;
  /** Charges one compile to the owner's daily quota; false when it is spent. */
  takeQuota: (owner: Address) => boolean;
  fetchImpl?: typeof fetch;
};

export type HandlerResult = { status: number; body: unknown };

export async function handleGuardianCompile(rawBody: unknown, deps: CompileRequestDeps): Promise<HandlerResult> {
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { error: "invalid body", details: parsed.error.issues } };
  if (!deps.llm) return { status: 503, body: { error: "LLM not configured", missing: deps.missing } };

  let caller: { owner: Address; account: Address };
  try {
    caller = await verifySignedRequest(parsed.data.auth, guardianRequestHash(parsed.data.text), {
      chainId: deps.chainId,
      nowSec: deps.nowSec,
    });
  } catch (e) {
    if (e instanceof RequestAuthError) return { status: 401, body: { error: e.message } };
    throw e;
  }

  try {
    await deps.assertEligible(caller);
  } catch (e) {
    return { status: 403, body: { error: "account not eligible", message: (e as Error).message } };
  }

  if (!deps.takeQuota(caller.owner)) {
    return { status: 429, body: { error: "daily guardian compile quota exhausted" } };
  }

  try {
    const out = await compileMandate({ text: parsed.data.text, llm: deps.llm, fetchImpl: deps.fetchImpl });
    return { status: 200, body: out };
  } catch (e) {
    if (e instanceof LlmError) return { status: 502, body: { error: `${e.provider}: ${e.message}` } };
    throw e;
  }
}
