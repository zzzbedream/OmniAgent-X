import { describe, expect, it } from "vitest";
import { GUARDIAN_SYSTEM, compileMandate } from "../src/guardian/compile";
import { describeGuardianAction, describeMandate } from "../src/guardian/describe";
import type { GuardianMandate } from "../src/guardian/mandate";

const llm = { name: "parser", baseUrl: "https://llm.test", apiKey: "k", model: "deepseek-flash" };

function replyWith(content: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: "deepseek-flash",
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 300, completion_tokens: 120 },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

describe("GUARDIAN_SYSTEM", () => {
  it("meets DeepSeek's JSON-mode requirements: the word json and an example object", () => {
    expect(GUARDIAN_SYSTEM.toLowerCase()).toContain("json");
    expect(GUARDIAN_SYSTEM).toContain('"rules"');
  });
});

describe("compileMandate", () => {
  it("turns the model draft into a complete mandate with code defaults", async () => {
    const out = await compileMandate({
      text: "Si me acerco a la liquidación, agrega 20 de margen; si sigue, corta la mitad; al final cierra.",
      llm,
      fetchImpl: replyWith({
        mandate: {
          markets: ["BTC"],
          rules: [
            { trigger: { kind: "liquidationBuffer", belowPct: 15 }, action: { type: "addCollateral", usd: 20 } },
            { trigger: { kind: "liquidationBuffer", belowPct: 8 }, action: { type: "reduce", fraction: 0.5 } },
            { trigger: { kind: "liquidationBuffer", belowPct: 4 }, action: { type: "close" } },
          ],
        },
        unsupported: [],
      }),
    });
    expect(out.mandate.cooldownSec).toBe(300);
    expect(out.mandate.collateralBudgetUsd).toBe(20);
    expect(out.violations).toEqual([]);
    expect(out.telemetry).toMatchObject({ model: "deepseek-flash", usage: { promptTokens: 300 } });
  });

  it("passes through what the guardian cannot do", async () => {
    const out = await compileMandate({
      text: "cierra todo si Elon tuitea",
      llm,
      fetchImpl: replyWith({
        mandate: { rules: [{ trigger: { kind: "maxLeverage", above: 10 }, action: { type: "close" } }] },
        unsupported: ["reacting to social media posts"],
      }),
    });
    expect(out.unsupported).toEqual(["reacting to social media posts"]);
  });

  it("rejects an out-of-range value instead of clamping it", async () => {
    await expect(
      compileMandate({
        text: "corta 30%",
        llm,
        fetchImpl: replyWith({
          mandate: { rules: [{ trigger: { kind: "liquidationBuffer", belowPct: 10 }, action: { type: "reduce", fraction: 0.3 } }] },
          unsupported: [],
        }),
      }),
    ).rejects.toThrow(/schema violation/);
  });
});

describe("describe", () => {
  const m: GuardianMandate = {
    version: 1,
    markets: ["BTC"],
    rules: [
      { trigger: { kind: "liquidationBuffer", belowPct: 15 }, action: { type: "addCollateral", usd: 20 } },
      { trigger: { kind: "drawdown", lossPct: 30 }, action: { type: "reduce", fraction: 0.5 } },
      { trigger: { kind: "maxLeverage", above: 8 }, action: { type: "close" } },
    ],
    cooldownSec: 300,
    maxActionsPerDay: 6,
    collateralBudgetUsd: 20,
  };

  it("renders every rule in plain English", () => {
    const lines = describeMandate(m);
    expect(lines[0]).toBe("If distance to liquidation falls below 15%: add 20 USD of collateral.");
    expect(lines[1]).toBe("If the loss reaches 30% of collateral: reduce the position by 50%.");
    expect(lines[2]).toBe("If leverage exceeds 8x: close the position.");
  });

  it("explains an action with the observed value, in dry-run or live voice", () => {
    const action = {
      market: "BTC" as const,
      type: "reduce" as const,
      fraction: 0.5 as const,
      lotLNS: 500n,
      hit: { trigger: { kind: "liquidationBuffer" as const, belowPct: 8 }, observed: 7.25 },
    };
    expect(describeGuardianAction(action, { dryRun: false })).toBe(
      "BTC: reduced the position by 50% because distance to liquidation (7.3%) fell below 8%.",
    );
    expect(describeGuardianAction(action, { dryRun: true })).toBe(
      "BTC: would reduce the position by 50% because distance to liquidation (7.3%) fell below 8%.",
    );
  });
});
