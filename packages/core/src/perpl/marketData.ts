// Perpl public market-data WebSocket (no auth): wss://<host>/ws/v1/market-data.
// Message shapes from PerplFoundation/api-docs websocket.md (mt 5/6 subscribe, mt 9 market state, mt 100 heartbeat).
// Prices in these messages are integers scaled by the market's price_decimals.

export const PERPL_TESTNET_WS = "wss://testnet.perpl.xyz/ws/v1/market-data";
export const PERPL_TESTNET_API = "https://testnet.perpl.xyz/api";

export type MarketState = {
  at?: unknown;
  orl: number; // oracle
  mrk: number; // mark
  lst: number; // last
  mid: number;
  bid: number;
  ask: number;
  prv: number; // price 24h ago
  dv: number; // daily volume (size)
  dva: string; // daily volume (amount)
  oi: number; // open interest
  tvl: string;
};

export type MarketDataMessage =
  | { kind: "market-state"; states: Record<string, MarketState> }
  | { kind: "heartbeat"; sn: number; head: number }
  | { kind: "subscription"; subs: { stream: string; code: number; error?: string }[] }
  | { kind: "other"; mt: number | undefined };

/** One frame subscribing to every stream the dashboard needs (well under the 16-subscription cap). */
export function subscriptionFrame(chainId: number) {
  return {
    mt: 5,
    subs: [
      { stream: `market-state@${chainId}`, subscribe: true },
      { stream: `heartbeat@${chainId}`, subscribe: true },
    ],
  };
}

export function parseMarketDataMessage(raw: string): MarketDataMessage {
  let msg: { mt?: number; [k: string]: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: "other", mt: undefined };
  }
  switch (msg.mt) {
    case 9: {
      const d = (msg.d ?? {}) as Record<string, MarketState | undefined>;
      const states: Record<string, MarketState> = {};
      for (const [id, st] of Object.entries(d)) if (st) states[id] = st;
      return { kind: "market-state", states };
    }
    case 100:
      return { kind: "heartbeat", sn: Number(msg.sn), head: Number(msg.h) };
    case 6: {
      const subs = (msg.subs as { stream: string; status?: { code: number; error?: string } }[] | undefined) ?? [];
      return {
        kind: "subscription",
        subs: subs.map(s => ({ stream: s.stream, code: s.status?.code ?? 0, error: s.status?.error })),
      };
    }
    default:
      return { kind: "other", mt: msg.mt };
  }
}

/** Heartbeat sequence numbers are strictly +1; a gap means missed messages (reconnect / resnapshot). */
export function heartbeatGap(prevSn: number | undefined, sn: number): boolean {
  return prevSn !== undefined && sn !== prevSn + 1;
}

export type MarketConfigSummary = {
  id: number;
  symbol: string;
  priceDecimals: number;
  sizeDecimals: number;
  initialMarginRaw: number;
  maintenanceMarginRaw: number;
};

/** Trim /v1/pub/context to what the dashboard uses. Throws on a shape it does not recognise. */
export function summarizeContext(ctx: unknown): MarketConfigSummary[] {
  const markets = (ctx as { markets?: unknown[] })?.markets;
  if (!Array.isArray(markets)) throw new Error("context has no markets array");
  return markets.map(m => {
    const mk = m as { id: number; symbol: string; config?: Record<string, number> };
    const c = mk.config ?? {};
    if (typeof c.price_decimals !== "number" || typeof c.size_decimals !== "number") {
      throw new Error(`market ${mk.id} has no decimals in config`);
    }
    return {
      id: mk.id,
      symbol: mk.symbol,
      priceDecimals: c.price_decimals,
      sizeDecimals: c.size_decimals,
      initialMarginRaw: c.initial_margin ?? 0,
      maintenanceMarginRaw: c.maintenance_margin ?? 0,
    };
  });
}
