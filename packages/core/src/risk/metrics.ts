// Position risk metrics for the dashboard.
// These are ESTIMATES from position size, entry, mark and deposit. They ignore funding, fees and
// Perpl's own margin formula (not published), so they are labelled as estimates in the UI.
// Collateral units are treated as USD (the collateral is a USD stablecoin).

export type Side = "long" | "short" | "unknown";

export type PositionInput = {
  side: Side;
  lotLNS: bigint;
  entryPricePNS: bigint;
  markPricePNS: bigint;
  depositCNS: bigint;
  priceDecimals: number;
  lotDecimals: number;
  collateralDecimals: number;
  /** Maintenance margin as a fraction (0.05 = 5%), or null when unknown. */
  maintenanceFraction: number | null;
};

export type PositionMetrics = {
  size: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  collateralUsd: number;
  unrealizedPnlUsd: number | null;
  equityUsd: number | null;
  effectiveLeverage: number | null;
  marginRatio: number | null;
  /** marginRatio − maintenance, in percentage points; below 0 means liquidatable under this estimate. */
  maintenanceBufferPct: number | null;
  estLiquidationPrice: number | null;
};

const scale = (v: bigint, decimals: number) => Number(v) / 10 ** decimals;

/**
 * Perpl's docs give `maintenance_margin: 2000 = 5%` and `initial_margin: 1000 = 10% (10x max)`: both fit
 * fraction = 100 / raw (raw is a max leverage in hundredths). Inferred from those two examples only.
 */
export function marginFractionFromRaw(raw: number | undefined | null): number | null {
  if (!raw || raw <= 0) return null;
  return 100 / raw;
}

export function positionMetrics(p: PositionInput): PositionMetrics {
  const size = scale(p.lotLNS, p.lotDecimals);
  const entryPrice = scale(p.entryPricePNS, p.priceDecimals);
  const markPrice = scale(p.markPricePNS, p.priceDecimals);
  const collateralUsd = scale(p.depositCNS, p.collateralDecimals);
  const notionalUsd = size * markPrice;
  const sign = p.side === "long" ? 1 : p.side === "short" ? -1 : 0;

  if (sign === 0 || size === 0) {
    return {
      size,
      entryPrice,
      markPrice,
      notionalUsd,
      collateralUsd,
      unrealizedPnlUsd: null,
      equityUsd: null,
      effectiveLeverage: null,
      marginRatio: null,
      maintenanceBufferPct: null,
      estLiquidationPrice: null,
    };
  }

  const unrealizedPnlUsd = sign * (markPrice - entryPrice) * size;
  const equityUsd = collateralUsd + unrealizedPnlUsd;
  const marginRatio = notionalUsd > 0 ? equityUsd / notionalUsd : null;
  const effectiveLeverage = equityUsd > 0 ? notionalUsd / equityUsd : null;
  const mm = p.maintenanceFraction;
  const maintenanceBufferPct = mm !== null && marginRatio !== null ? (marginRatio - mm) * 100 : null;

  // Solve collateral + sign·(P − entry)·size = mm·P·size for P.
  let estLiquidationPrice: number | null = null;
  if (mm !== null) {
    const denom = size * (sign - mm);
    const liq = denom !== 0 ? (sign * entryPrice * size - collateralUsd) / denom : NaN;
    estLiquidationPrice = Number.isFinite(liq) && liq > 0 ? liq : null;
  }

  return {
    size,
    entryPrice,
    markPrice,
    notionalUsd,
    collateralUsd,
    unrealizedPnlUsd,
    equityUsd,
    effectiveLeverage,
    marginRatio,
    maintenanceBufferPct,
    estLiquidationPrice,
  };
}

export type PortfolioSummary = {
  totalNotionalUsd: number;
  totalCollateralUsd: number;
  totalUnrealizedPnlUsd: number | null;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  /** Largest single-market share of gross notional (0..1). */
  concentration: number | null;
  minMaintenanceBufferPct: number | null;
};

export function portfolioSummary(rows: { side: Side; metrics: PositionMetrics }[]): PortfolioSummary {
  let totalNotionalUsd = 0;
  let totalCollateralUsd = 0;
  let pnl: number | null = 0;
  let longNotionalUsd = 0;
  let shortNotionalUsd = 0;
  let maxNotional = 0;
  let minBuffer: number | null = null;
  for (const { side, metrics: m } of rows) {
    totalNotionalUsd += m.notionalUsd;
    totalCollateralUsd += m.collateralUsd;
    pnl = pnl === null || m.unrealizedPnlUsd === null ? null : pnl + m.unrealizedPnlUsd;
    if (side === "long") longNotionalUsd += m.notionalUsd;
    if (side === "short") shortNotionalUsd += m.notionalUsd;
    maxNotional = Math.max(maxNotional, m.notionalUsd);
    if (m.maintenanceBufferPct !== null) {
      minBuffer = minBuffer === null ? m.maintenanceBufferPct : Math.min(minBuffer, m.maintenanceBufferPct);
    }
  }
  return {
    totalNotionalUsd,
    totalCollateralUsd,
    totalUnrealizedPnlUsd: rows.length === 0 ? 0 : pnl,
    longNotionalUsd,
    shortNotionalUsd,
    concentration: totalNotionalUsd > 0 ? maxNotional / totalNotionalUsd : null,
    minMaintenanceBufferPct: minBuffer,
  };
}

export type MarketRow = {
  mark: number;
  oracle: number;
  bid: number;
  ask: number;
  spreadBps: number | null;
  markOracleDevBps: number | null;
  change24hPct: number | null;
  openInterest: number;
};

/** Market-level risk signals from a Perpl market-state message (integer prices scaled by priceDecimals). */
export function marketRow(
  s: { mrk: number; orl: number; bid: number; ask: number; prv: number; oi: number },
  priceDecimals: number,
  sizeDecimals: number,
): MarketRow {
  const k = 10 ** priceDecimals;
  const mark = s.mrk / k;
  const oracle = s.orl / k;
  const bid = s.bid / k;
  const ask = s.ask / k;
  const mid = (bid + ask) / 2;
  return {
    mark,
    oracle,
    bid,
    ask,
    spreadBps: bid > 0 && ask > 0 && ask >= bid ? ((ask - bid) / mid) * 10_000 : null,
    markOracleDevBps: oracle > 0 ? ((mark - oracle) / oracle) * 10_000 : null,
    change24hPct: s.prv > 0 ? ((s.mrk - s.prv) / s.prv) * 100 : null,
    openInterest: s.oi / 10 ** sizeDecimals,
  };
}
