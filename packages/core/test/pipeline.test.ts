import { describe, expect, it } from "vitest";
import { LlmError, chatJson, extractJsonObject, llmRolesFromEnv } from "../src/strategy/llm";
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

/** Replies with each content in turn and records every request body. */
function sequenceFetch(contents: string[]) {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const content = contents[Math.min(bodies.length - 1, contents.length - 1)];
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, bodies };
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

describe("llmRolesFromEnv", () => {
  const env = { LLM_BASE_URL: "https://api.deepseek.com", LLM_API_KEY: "sk-test", LLM_MODEL: "deepseek-flash" };

  it("uses one provider for both roles", () => {
    const { roles, missing } = llmRolesFromEnv(env);
    expect(missing).toEqual([]);
    expect(roles?.parser).toMatchObject({ name: "parser", baseUrl: env.LLM_BASE_URL, model: "deepseek-flash" });
    expect(roles?.planner).toMatchObject({ name: "planner", model: "deepseek-flash" });
  });

  it("lets the planner use a different model", () => {
    const { roles } = llmRolesFromEnv({ ...env, LLM_PLANNER_MODEL: "deepseek-v4-pro" });
    expect(roles?.parser.model).toBe("deepseek-flash");
    expect(roles?.planner.model).toBe("deepseek-v4-pro");
  });

  it("lists every missing variable", () => {
    const { roles, missing } = llmRolesFromEnv({ LLM_MODEL: "deepseek-flash" });
    expect(roles).toBeNull();
    expect(missing).toEqual(["LLM_BASE_URL", "LLM_API_KEY"]);
  });

  it("treats a blank LLM_MAX_TOKENS (as copied from .env.example) as unset", () => {
    const { roles, missing } = llmRolesFromEnv({ ...env, LLM_MAX_TOKENS: "  " });
    expect(missing).toEqual([]);
    expect(roles?.parser.maxTokens).toBeUndefined();
  });

  it("rejects a non-positive LLM_MAX_TOKENS instead of ignoring it", () => {
    const { roles, missing } = llmRolesFromEnv({ ...env, LLM_MAX_TOKENS: "0" });
    expect(roles).toBeNull();
    expect(missing).toEqual(["LLM_MAX_TOKENS (positive integer)"]);
  });
});

describe("chatJson", () => {
  it("throws LlmError with the raw reply on a schema violation", async () => {
    const f = fakeFetch({ "parser-model": { budgetUsd: "a lot" } });
    await expect(chatJson(cfg("parser"), IntentParamsSchema, "s", "u", f)).rejects.toBeInstanceOf(LlmError);
  });

  it("surfaces HTTP errors", async () => {
    await expect(chatJson(cfg("nope"), IntentParamsSchema, "s", "u", fakeFetch({}))).rejects.toThrow(/HTTP 404/);
  });

  it("asks for JSON output with a token cap", async () => {
    const { f, bodies } = sequenceFetch([JSON.stringify(intent)]);
    await chatJson({ ...cfg("parser"), maxTokens: 512 }, IntentParamsSchema, "s", "u", f);
    expect(bodies[0]).toMatchObject({ temperature: 0, max_tokens: 512, response_format: { type: "json_object" } });
  });

  it("retries once when the reply is empty", async () => {
    const { f, bodies } = sequenceFetch(["", JSON.stringify(intent)]);
    const out = await chatJson(cfg("parser"), IntentParamsSchema, "s", "u", f);
    expect(bodies).toHaveLength(2);
    expect(out.data.markets).toEqual(["ETH"]);
  });

  it("gives up after a second empty reply", async () => {
    const { f, bodies } = sequenceFetch(["", "  "]);
    await expect(chatJson(cfg("parser"), IntentParamsSchema, "s", "u", f)).rejects.toThrow(/empty reply/);
    expect(bodies).toHaveLength(2);
  });
});

describe("runPlanningPipeline", () => {
  it("chains parser → planner → risk policy", async () => {
    const f = fakeFetch({
      "parser-model": intent,
      "planner-model": {
        orders: [{ market: "ETH", side: "short", notionalUsd: 600, leverage: 2 }],
        summary: "Short ETH as a hedge",
        riskNotes: "Keep 700 USD unallocated",
      },
    });
    const out = await runPlanningPipeline({
      request: "hedge ETH",
      budgetUsd: 1000,
      quotes: [{ market: "ETH", markPriceUsd: 2500, fundingRatePct: null }],
      parser: cfg("parser"),
      planner: cfg("planner"),
      fetchImpl: f,
    });
    expect(out.intent.data.unsupported).toEqual(["spot altcoin orders"]);
    expect(out.risk.ok).toBe(true);
    expect(out.risk.requiredMarginUsd).toBe(300);
  });

  it("reports policy violations from an over-levered plan", async () => {
    const f = fakeFetch({
      "parser-model": intent,
      "planner-model": {
        orders: [{ market: "ETH", side: "short", notionalUsd: 3000, leverage: 10 }],
        summary: "",
        riskNotes: "",
      },
    });
    const out = await runPlanningPipeline({
      request: "all in",
      budgetUsd: 100,
      quotes: [],
      parser: cfg("parser"),
      planner: cfg("planner"),
      fetchImpl: f,
    });
    expect(out.risk.ok).toBe(false);
    expect(out.risk.violations.map(v => v.rule)).toEqual(expect.arrayContaining(["maxLeverage", "budget"]));
  });
});
