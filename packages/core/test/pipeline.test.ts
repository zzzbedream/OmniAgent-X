import { describe, expect, it } from "vitest";
import { LlmError, chatJson, extractJsonObject } from "../src/strategy/llm";
import { runPlanningPipeline } from "../src/strategy/pipeline";
import { IntentParamsSchema } from "../src/strategy/schema";

const cfg = (name: string) => ({ name, baseUrl: "https://llm.test/v1", apiKey: "k", model: `${name}-model` });

function fakeFetch(replies: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const content = replies[body.model];
    if (content === undefined) return new Response("no such model", { status: 404 });
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

const intent = {
  budgetUsd: 1000,
  markets: ["ETH"],
  bias: [{ market: "ETH", direction: "short" }],
  riskAppetite: "medium",
  conditions: ["high volatility"],
  unsupported: ["spot altcoin orders"],
};

describe("extractJsonObject", () => {
  it("unwraps fenced JSON", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("chatJson", () => {
  it("throws LlmError with the raw reply on a schema violation", async () => {
    const f = fakeFetch({ "kimi-model": { budgetUsd: "a lot" } });
    await expect(chatJson(cfg("kimi"), IntentParamsSchema, "s", "u", f)).rejects.toBeInstanceOf(LlmError);
  });
  it("surfaces HTTP errors", async () => {
    await expect(chatJson(cfg("nope"), IntentParamsSchema, "s", "u", fakeFetch({}))).rejects.toThrow(/HTTP 404/);
  });
});

describe("runPlanningPipeline", () => {
  it("chains Kimi → Qwen → risk policy", async () => {
    const f = fakeFetch({
      "kimi-model": intent,
      "qwen-model": {
        orders: [{ market: "ETH", side: "short", notionalUsd: 600, leverage: 2 }],
        summary: "Short ETH as a hedge",
        riskNotes: "Keep 700 USD unallocated",
      },
    });
    const out = await runPlanningPipeline({
      request: "hedge ETH",
      budgetUsd: 1000,
      quotes: [{ market: "ETH", markPriceUsd: 2500, fundingRatePct: null }],
      kimi: cfg("kimi"),
      qwen: cfg("qwen"),
      fetchImpl: f,
    });
    expect(out.intent.data.unsupported).toEqual(["spot altcoin orders"]);
    expect(out.risk.ok).toBe(true);
    expect(out.risk.requiredMarginUsd).toBe(300);
  });
  it("reports policy violations from an over-levered plan", async () => {
    const f = fakeFetch({
      "kimi-model": intent,
      "qwen-model": {
        orders: [{ market: "ETH", side: "short", notionalUsd: 3000, leverage: 10 }],
        summary: "",
        riskNotes: "",
      },
    });
    const out = await runPlanningPipeline({
      request: "all in",
      budgetUsd: 100,
      quotes: [],
      kimi: cfg("kimi"),
      qwen: cfg("qwen"),
      fetchImpl: f,
    });
    expect(out.risk.ok).toBe(false);
    expect(out.risk.violations.map(v => v.rule)).toEqual(expect.arrayContaining(["maxLeverage", "budget"]));
  });
});
