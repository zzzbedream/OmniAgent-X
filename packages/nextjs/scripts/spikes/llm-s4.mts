// Spike S4 (docs/PLAN.md §4): the configured LLM returns schema-valid JSON at temperature 0; measure latency
// and tokens. Same env vars as the app (OpenAI-compatible /chat/completions):
//   LLM_BASE_URL=https://api.deepseek.com  LLM_API_KEY=...  LLM_MODEL=deepseek-flash  [LLM_PLANNER_MODEL=deepseek-v4-pro]
// Run (from packages/nextjs): node --experimental-strip-types scripts/spikes/llm-s4.mts [runs=3]
import { z } from "zod";

const Plan = z.object({
  orders: z
    .array(
      z.object({
        market: z.enum(["ETH", "BTC", "SOL", "MON"]),
        side: z.enum(["long", "short"]),
        notionalUsd: z.number().positive().max(1000),
        leverage: z.number().min(1).max(5),
      }),
    )
    .max(4),
  rationale: z.string().max(500),
});

const SYSTEM = `You are a risk-constrained trading planner. Reply with ONLY a JSON object:
{"orders":[{"market":"ETH|BTC|SOL|MON","side":"long|short","notionalUsd":number,"leverage":number}],"rationale":string}
Constraints: total notional <= budget, leverage 1-5, at most 4 orders, rationale <= 500 chars.`;
const USER = `Budget: 1000 USD. Intent: "Hedge ETH short during high volatility, keep the rest idle." Current ETH 24h realized vol: 4.1%.`;

type Provider = { name: string; baseUrl?: string; apiKey?: string; model?: string };
const { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL, LLM_PLANNER_MODEL } = process.env;
const providers: Provider[] = [
  { name: "LLM_MODEL", baseUrl, apiKey, model: LLM_MODEL },
  ...(LLM_PLANNER_MODEL ? [{ name: "LLM_PLANNER_MODEL", baseUrl, apiKey, model: LLM_PLANNER_MODEL }] : []),
];
const runs = Number(process.argv[2] ?? 3);

async function callOnce(p: Required<Provider>) {
  const started = performance.now();
  const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      temperature: 0,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
    }),
  });
  const ms = Math.round(performance.now() - started);
  if (!res.ok) return { ms, ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const body = await res.json();
  const content: string = body.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ms, ok: false, detail: `non-JSON content: ${content.slice(0, 120)}` };
  }
  const result = Plan.safeParse(parsed);
  const total = result.success ? result.data.orders.reduce((s, o) => s + o.notionalUsd, 0) : NaN;
  return {
    ms,
    ok: result.success && total <= 1000,
    detail: result.success ? `orders=${result.data.orders.length} notional=${total}` : result.error.issues[0]?.message,
    usage: body.usage,
    fingerprint: JSON.stringify(parsed),
  };
}

for (const p of providers) {
  if (!p.baseUrl || !p.apiKey || !p.model) {
    console.log(`SKIP  ${p.name}: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL`);
    continue;
  }
  const outputs = new Set<string>();
  for (let i = 0; i < runs; i++) {
    const r = await callOnce(p as Required<Provider>);
    if (r.fingerprint) outputs.add(r.fingerprint);
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${p.name} run ${i + 1}: ${r.ms} ms, ${r.detail}, usage=${JSON.stringify(r.usage ?? {})}`,
    );
  }
  // Relevant for CRE consensus: identical outputs across calls at temperature 0 are NOT guaranteed.
  console.log(`INFO  ${p.name}: ${outputs.size} distinct outputs over ${runs} runs`);
}
