// Server-side proxy for Perpl's public /v1/pub/context (market decimals and margin config).
// Proxied so the browser does not depend on Perpl's CORS policy (not documented).
import { NextResponse } from "next/server";
import { PERPL_TESTNET_API, summarizeContext } from "@omniagent/core";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
  const base = process.env.PERPL_API_URL || PERPL_TESTNET_API;
  try {
    const res = await fetch(`${base}/v1/pub/context`, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ error: `Perpl context HTTP ${res.status}` }, { status: 502 });
    return NextResponse.json({ markets: summarizeContext(await res.json()) });
  } catch (e) {
    return NextResponse.json({ error: "could not load Perpl context", message: (e as Error).message }, { status: 502 });
  }
}
