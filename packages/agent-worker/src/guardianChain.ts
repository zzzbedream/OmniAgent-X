// Chain-facing pieces of the guardian: turn a mandate's account into GuardedPositions the engine can read.
// Side comes from this worker's own log (verified order enum) or the indexer calibration, never from the
// raw PositionEnum. Maintenance margin comes from Perpl's public context; without it the engine refuses
// to act on buffer rules.
import {
  type GuardedPosition,
  MARKET_SYMBOLS,
  type MarketSymbol,
  PERPL_TESTNET,
  marginFractionFromRaw,
  positionMetrics,
  readCollateral,
  readDelegatedAccount,
  readPerpSnapshot,
  readPositions,
  summarizeContext,
} from "@omniagent/core";
import type { PublicClient } from "viem";
import { sideFromIndexer } from "./executor";
import type { GuardianStore, MandateRecord } from "./guardian";
import type { DecisionLog } from "./log";

const CONTEXT_TTL_MS = 60_000;

/** Caches one async value for `ttlMs`. A failed refresh serves the last good value; with none, it throws. */
function cached<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let value: { v: T; at: number } | undefined;
  return async () => {
    if (value && Date.now() - value.at < ttlMs) return value.v;
    try {
      const v = await load();
      value = { v, at: Date.now() };
      return v;
    } catch (e) {
      if (value) return value.v;
      throw e;
    }
  };
}

export function makePositionReader(deps: {
  client: PublicClient;
  log: DecisionLog;
  /** Remembers each position's side once resolved (a close that did not fill must not make it unknown). */
  sides: Pick<GuardianStore, "sideFor" | "rememberSide" | "forgetSide">;
  mode: "dry-run" | "live";
  perplApiUrl: string;
  indexerUrl?: string;
  fetchImpl?: typeof fetch;
}): (rec: MandateRecord) => Promise<GuardedPosition[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const collateralDecimals = cached(async () => (await readCollateral(deps.client)).decimals, Number.POSITIVE_INFINITY);
  const maintenanceBySymbol = cached(async () => {
    const res = await fetchImpl(`${deps.perplApiUrl.replace(/\/$/, "")}/v1/pub/context`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Perpl context HTTP ${res.status}`);
    return new Map(summarizeContext(await res.json()).map(m => [m.symbol, marginFractionFromRaw(m.maintenanceMarginRaw)]));
  }, CONTEXT_TTL_MS);

  return async rec => {
    const acc = await readDelegatedAccount(deps.client, rec.account);
    if (acc.accountId === 0n) return [];
    const [onChain, decimals, maintenance] = await Promise.all([
      readPositions(deps.client, acc.accountId),
      collateralDecimals(),
      // A context outage only disables buffer rules (null maintenance); drawdown and leverage still work.
      maintenanceBySymbol().catch(() => new Map<string, number | null>()),
    ]);
    const open = new Set(onChain.map(p => p.market));
    for (const market of MARKET_SYMBOLS) if (!open.has(market)) deps.sides.forgetSide(rec.account, market);
    return Promise.all(
      onChain.map(async (p): Promise<GuardedPosition> => {
        const perp = await readPerpSnapshot(deps.client, p.market as MarketSymbol);
        const perpId = PERPL_TESTNET.markets[p.market];
        const resolved =
          deps.log.sideForMarket(rec.account, perpId, deps.mode) ??
          deps.sides.sideFor(rec.account, p.market) ??
          (deps.indexerUrl ? await sideFromIndexer(deps.indexerUrl, p.positionTypeRaw) : undefined);
        if (resolved) deps.sides.rememberSide(rec.account, p.market, resolved);
        const side = resolved ?? "unknown";
        const metrics = positionMetrics({
          side,
          lotLNS: p.lotLNS,
          entryPricePNS: p.entryPricePNS,
          markPricePNS: p.markPricePNS,
          depositCNS: p.depositCNS,
          priceDecimals: Number(perp.priceDecimals),
          lotDecimals: Number(perp.lotDecimals),
          collateralDecimals: decimals,
          maintenanceFraction: maintenance.get(p.market) ?? null,
        });
        return { market: p.market, side, lotLNS: p.lotLNS, markPriceValid: p.markPriceValid, metrics };
      }),
    );
  };
}
