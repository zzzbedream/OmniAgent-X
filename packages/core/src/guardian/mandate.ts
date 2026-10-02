// Guardian mandate: the bounded, typed rules a user signs once so the worker may protect their positions.
// The model drafts it from plain language; code fills defaults, validates it, and hashes it for the
// EIP-712 signature. Anything out of range is rejected, never clamped (same rule as RiskPolicy).
import { type Hex, keccak256, toBytes } from "viem";
import { z } from "zod";
import { MARKET_SYMBOLS, type MarketSymbol } from "../perpl/network";

const marketEnum = z.enum(MARKET_SYMBOLS as [MarketSymbol, ...MarketSymbol[]]);

export const REDUCE_FRACTIONS = [0.25, 0.5, 0.75] as const;
export type ReduceFraction = (typeof REDUCE_FRACTIONS)[number];

export const GuardianTriggerSchema = z.discriminatedUnion("kind", [
  /** Estimated margin ratio minus maintenance, in percentage points (risk/metrics.ts maintenanceBufferPct). */
  z.object({ kind: z.literal("liquidationBuffer"), belowPct: z.number().min(0.5).max(50) }),
  /** Unrealized loss as a percentage of the position's collateral. */
  z.object({ kind: z.literal("drawdown"), lossPct: z.number().min(1).max(100) }),
  /** Effective leverage (notional / equity). */
  z.object({ kind: z.literal("maxLeverage"), above: z.number().min(1).max(50) }),
]);
export type GuardianTrigger = z.infer<typeof GuardianTriggerSchema>;

export const GuardianActionSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addCollateral"), usd: z.number().positive().max(10_000) }),
  z.object({ type: z.literal("reduce"), fraction: z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75)]) }),
  z.object({ type: z.literal("close") }),
]);
export type GuardianActionSpec = z.infer<typeof GuardianActionSpecSchema>;

export const GuardianRuleSchema = z.object({ trigger: GuardianTriggerSchema, action: GuardianActionSpecSchema });
export type GuardianRule = z.infer<typeof GuardianRuleSchema>;

export const GuardianMandateSchema = z.object({
  version: z.literal(1),
  /** Positions the guardian may touch; any other market is left alone. */
  markets: z.array(marketEnum).min(1).max(MARKET_SYMBOLS.length),
  rules: z.array(GuardianRuleSchema).min(1).max(6),
  /** Minimum time between two non-closing actions on one market. */
  cooldownSec: z.number().int().min(30).max(86_400),
  /** Non-closing actions per UTC day across all markets. */
  maxActionsPerDay: z.number().int().min(1).max(50),
  /** Total collateral the guardian may add over the mandate's life, in USD. */
  collateralBudgetUsd: z.number().min(0).max(100_000),
});
export type GuardianMandate = z.infer<typeof GuardianMandateSchema>;

/** What the model is asked for: only the rules are required, so it never has to invent the rest. */
export const GuardianMandateDraftSchema = z.object({
  markets: z.array(marketEnum).min(1).max(MARKET_SYMBOLS.length).optional(),
  rules: z.array(GuardianRuleSchema).min(1).max(6),
  cooldownSec: z.number().int().min(30).max(86_400).optional(),
  maxActionsPerDay: z.number().int().min(1).max(50).optional(),
  collateralBudgetUsd: z.number().min(0).max(100_000).optional(),
});
export type GuardianMandateDraft = z.infer<typeof GuardianMandateDraftSchema>;

export const GUARDIAN_DEFAULTS = { cooldownSec: 300, maxActionsPerDay: 6 } as const;

/**
 * Code defaults for the fields the user did not state. The default collateral budget allows one top-up
 * of the largest size the user named, so the guardian never spends more than the user mentioned.
 */
export function finalizeMandate(draft: GuardianMandateDraft): GuardianMandate {
  const topUps = draft.rules.flatMap(r => (r.action.type === "addCollateral" ? [r.action.usd] : []));
  return GuardianMandateSchema.parse({
    version: 1,
    markets: draft.markets ?? MARKET_SYMBOLS,
    rules: draft.rules,
    cooldownSec: draft.cooldownSec ?? GUARDIAN_DEFAULTS.cooldownSec,
    maxActionsPerDay: draft.maxActionsPerDay ?? GUARDIAN_DEFAULTS.maxActionsPerDay,
    collateralBudgetUsd: draft.collateralBudgetUsd ?? (topUps.length > 0 ? Math.max(...topUps) : 0),
  });
}

export type MandateViolation = { rule: string; detail: string };

/** Cross-field checks the schema cannot express. */
export function validateMandate(m: GuardianMandate): MandateViolation[] {
  return m.rules.flatMap((r, i) =>
    r.action.type === "addCollateral" && r.action.usd > m.collateralBudgetUsd
      ? [
          {
            rule: "collateralBudget",
            detail: `rule[${i}] adds ${r.action.usd} USD but the collateral budget is ${m.collateralBudgetUsd} USD`,
          },
        ]
      : [],
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** keccak256 of the parsed mandate as canonical JSON (sorted keys), so field order cannot change it. */
export function hashMandate(m: GuardianMandate): Hex {
  return keccak256(toBytes(canonicalJson(GuardianMandateSchema.parse(m))));
}

/** Signed once by the owner (domain: APPROVAL_DOMAIN). The worker stores the mandate whose hash matches. */
export const GUARDIAN_MANDATE_TYPES = {
  GuardianMandate: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "mandateHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

/** Owner request to stop the guardian on one account. */
export const GUARDIAN_REVOKE_TYPES = {
  GuardianRevoke: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
