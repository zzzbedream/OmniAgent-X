// ERC-8004 registration file for the guardian (the agentURI the Identity Registry points at).
import { NextResponse } from "next/server";
import { buildAgentCard } from "@omniagent/core";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
  const rawId = process.env.NEXT_PUBLIC_GUARDIAN_AGENT_ID;
  const agentId = rawId && /^\d+$/.test(rawId) ? BigInt(rawId) : undefined;
  return NextResponse.json(buildAgentCard({ appUrl, workerUrl, agentId }), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
