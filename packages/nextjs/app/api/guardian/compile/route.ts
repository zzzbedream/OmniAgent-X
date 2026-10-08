// POST /api/guardian/compile — plain-language protection rules → guardian mandate (not signed, not active).
// Server-only: the LLM key never reaches the browser. The user signs the returned mandate and the worker
// re-validates it. All checks live in core's handleGuardianCompile (unit-tested).
import { NextResponse } from "next/server";
import { DailyQuota, PERPL_TESTNET, handleGuardianCompile, llmRolesFromEnv } from "@omniagent/core";
import { assertEligibleAccount, envInt } from "~~/lib/omni/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In memory and per process, like /api/strategy's quota.
const quota = new DailyQuota();

export async function POST(req: Request) {
  const { roles, missing } = llmRolesFromEnv(process.env);
  const result = await handleGuardianCompile(await req.json().catch(() => null), {
    llm: roles?.parser ?? null,
    missing,
    chainId: PERPL_TESTNET.chainId,
    nowSec: BigInt(Math.floor(Date.now() / 1000)),
    assertEligible: assertEligibleAccount,
    takeQuota: owner =>
      quota.take(`owner:${owner}`, envInt("LLM_MAX_MANDATES_PER_OWNER_PER_DAY", 20)) &&
      quota.take("global", envInt("LLM_MAX_MANDATES_PER_DAY", 200)),
  });
  return NextResponse.json(result.body, { status: result.status });
}
