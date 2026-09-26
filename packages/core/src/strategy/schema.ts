import { z } from "zod";
import { MARKET_SYMBOLS, type MarketSymbol } from "../perpl/network";

const marketEnum = z.enum(MARKET_SYMBOLS as [MarketSymbol, ...MarketSymbol[]]);

/** Output of the intent-parsing step (Kimi): what the user asked for, no numbers invented. */
export const IntentParamsSchema = z.object({
  budgetUsd: z.number().positive().nullable(),
  markets: z.array(marketEnum).max(4),
  bias: z.array(z.object({ market: marketEnum, direction: z.enum(["long", "short", "hedge", "neutral"]) })).max(4),
  riskAppetite: z.enum(["low", "medium", "high"]),
  conditions: z.array(z.string().max(200)).max(5),
  unsupported: z.array(z.string().max(200)).max(5),
});
export type IntentParams = z.infer<typeof IntentParamsSchema>;

export const PlannedOrderSchema = z.object({
  market: marketEnum,
  side: z.enum(["long", "short"]),
  notionalUsd: z.number().positive(),
  leverage: z.number().min(1),
});
export type PlannedOrder = z.infer<typeof PlannedOrderSchema>;

/** Output of the planning step (Qwen). Deterministic checks run after this; nothing executes unchecked. */
export const TradePlanSchema = z.object({
  orders: z.array(PlannedOrderSchema).max(8),
  summary: z.string().max(600),
  riskNotes: z.string().max(600),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;
