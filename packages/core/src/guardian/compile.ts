// Plain-language protection rules → guardian mandate. The model only drafts the rules; code applies
// defaults, validates, hashes and describes the result. The user signs what describeMandate shows.
import { z } from "zod";
import { type LlmConfig, type LlmUsage, chatJson } from "../strategy/llm";
import { describeMandate } from "./describe";
import {
  type GuardianMandate,
  GuardianMandateDraftSchema,
  type MandateViolation,
  finalizeMandate,
  hashMandate,
  validateMandate,
} from "./mandate";

// DeepSeek JSON mode needs the word "json" and an example object in the prompt.
export const GUARDIAN_SYSTEM = `You turn a trader's protection rules for perpetual-futures positions into a guardian mandate.
Output ONLY a JSON object like this example:
{"mandate":{"markets":["BTC"],"rules":[
 {"trigger":{"kind":"liquidationBuffer","belowPct":15},"action":{"type":"addCollateral","usd":20}},
 {"trigger":{"kind":"liquidationBuffer","belowPct":8},"action":{"type":"reduce","fraction":0.5}},
 {"trigger":{"kind":"liquidationBuffer","belowPct":4},"action":{"type":"close"}}]},
 "unsupported":[],"assumptions":[]}
Triggers: liquidationBuffer (belowPct: distance to liquidation in percentage points, 0.5 to 50),
drawdown (lossPct: unrealized loss as a percentage of the position's collateral, 1 to 100),
maxLeverage (above: effective leverage, 1 to 50).
Actions: addCollateral (usd), reduce (fraction: exactly 0.25, 0.5 or 0.75), close.
Rules:
- At most 6 rules. Markets are BTC, ETH, SOL and MON; omit "markets" when the user names none.
- Use addCollateral only when the user gave an amount; never invent amounts.
- When the user states a threshold vaguely (e.g. "close to liquidation"), pick a value and say so in "assumptions".
- Omit cooldownSec, maxActionsPerDay and collateralBudgetUsd unless the user stated them.
- The guardian can never open positions or withdraw funds. List anything else it cannot express in "unsupported".`;

export const CompiledMandateSchema = z.object({
  mandate: GuardianMandateDraftSchema,
  unsupported: z.array(z.string().max(200)).max(5),
  assumptions: z.array(z.string().max(200)).max(5).optional(),
});

export type CompiledMandate = {
  mandate: GuardianMandate;
  mandateHash: `0x${string}`;
  /** What the user will sign, one line per rule. */
  lines: string[];
  unsupported: string[];
  assumptions: string[];
  violations: MandateViolation[];
  telemetry: { model: string; latencyMs: number; usage: LlmUsage };
};

export async function compileMandate(args: {
  text: string;
  llm: LlmConfig;
  fetchImpl?: typeof fetch;
}): Promise<CompiledMandate> {
  const res = await chatJson(args.llm, CompiledMandateSchema, GUARDIAN_SYSTEM, args.text, args.fetchImpl);
  const mandate = finalizeMandate(res.data.mandate);
  return {
    mandate,
    mandateHash: hashMandate(mandate),
    lines: describeMandate(mandate),
    unsupported: res.data.unsupported,
    assumptions: res.data.assumptions ?? [],
    violations: validateMandate(mandate),
    telemetry: { model: res.model, latencyMs: res.latencyMs, usage: res.usage },
  };
}
