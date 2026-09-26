"use client";

// Phase 3 risk dashboard.
// Sources: Perpl public market-data WebSocket (live prices), on-chain reads (account + positions, authoritative),
// the agent worker's decision log, and optionally the Envio indexer (history + side calibration).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APPROVAL_DOMAIN,
  CLOSE_APPROVAL_TYPES,
  MARKET_SYMBOLS,
  type MarketConfigSummary,
  type MarketSymbol,
  type OnChainPosition,
  PERPL_TESTNET,
  type PerpSnapshot,
  type PositionMetrics,
  marginFractionFromRaw,
  marketRow,
  portfolioSummary,
  positionMetrics,
  readCollateral,
  readDelegatedAccount,
  readPerpSnapshot,
  readPositions,
} from "@omniagent/core";
import type { NextPage } from "next";
import { type Address, formatUnits, isAddress } from "viem";
import { useMarketData } from "~~/hooks/omni/useMarketData";
import { type Calibration, INDEXER_URL, type IndexedEvent, fetchIndexed, sideForRaw } from "~~/lib/omni/indexer";
import { loadDelegatedAccount, worker } from "~~/lib/omni/worker";
import { publicClient, useMera } from "~~/services/mera/MeraProvider";

const POLL_MS = 10_000;
const BUFFER_WARN_PCT = 5;

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString(undefined, { maximumFractionDigits: digits });

type AccountView = {
  address: Address;
  owner: Address;
  accountId: bigint;
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  collateral: { decimals: number; symbol: string };
  positions: OnChainPosition[];
  perps: Partial<Record<MarketSymbol, PerpSnapshot>>;
  readAt: number;
};

const Dashboard: NextPage = () => {
  const { account, walletClient } = useMera();
  const [closing, setClosing] = useState<string>();
  const [closeResult, setCloseResult] = useState<string>();
  const market = useMarketData();
  const [context, setContext] = useState<MarketConfigSummary[]>();
  const [contextError, setContextError] = useState<string>();
  const [target, setTarget] = useState<Address>();
  const [view, setView] = useState<AccountView>();
  const [readError, setReadError] = useState<string>();
  const [decisions, setDecisions] = useState<Record<string, unknown>[]>();
  const [indexed, setIndexed] = useState<{ events: IndexedEvent[]; calibrations: Calibration[] }>();
  const [indexerError, setIndexerError] = useState<string>();

  // Account to watch: ?account=0x… (read-only view for anyone) or the signed-in user's DelegatedAccount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("account");
    if (q && isAddress(q)) setTarget(q);
    else if (account) setTarget(loadDelegatedAccount(account.address));
  }, [account]);

  useEffect(() => {
    fetch("/api/perpl/context")
      .then(r => r.json())
      .then(b => (b.markets ? setContext(b.markets) : setContextError(b.error ?? "context unavailable")))
      .catch(e => setContextError((e as Error).message));
  }, []);

  const readAccount = useCallback(async () => {
    if (!target) return;
    try {
      const [acc, collateral] = await Promise.all([
        readDelegatedAccount(publicClient, target),
        readCollateral(publicClient),
      ]);
      const positions = acc.accountId > 0n ? await readPositions(publicClient, acc.accountId) : [];
      const perps: AccountView["perps"] = {};
      await Promise.all(positions.map(async p => (perps[p.market] = await readPerpSnapshot(publicClient, p.market))));
      setView({
        address: target,
        owner: acc.owner,
        accountId: acc.accountId,
        balanceCNS: acc.balanceCNS,
        lockedBalanceCNS: acc.lockedBalanceCNS,
        collateral,
        positions,
        perps,
        readAt: Date.now(),
      });
      setReadError(undefined);
    } catch (e) {
      setReadError((e as Error).message.split("\n")[0]);
    }
  }, [target]);

  useEffect(() => {
    void readAccount();
    const id = setInterval(readAccount, POLL_MS);
    return () => clearInterval(id);
  }, [readAccount]);

  useEffect(() => {
    if (!target) return;
    const load = () => {
      worker
        .decisions(target)
        .then(r => setDecisions(r.entries))
        .catch(() => setDecisions(undefined));
      if (INDEXER_URL && view?.accountId) {
        fetchIndexed(view.accountId)
          .then(r => {
            setIndexed({ events: r.AccountEvent, calibrations: r.SideCalibration });
            setIndexerError(undefined);
          })
          .catch(e => setIndexerError((e as Error).message));
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [target, view?.accountId]);

  const contextById = useMemo(() => new Map((context ?? []).map(c => [c.id, c])), [context]);

  const rows = useMemo(() => {
    if (!view) return [];
    return view.positions.map(p => {
      const perp = view.perps[p.market];
      const cfg = contextById.get(Number(p.perpId));
      const side = sideForRaw(p.positionTypeRaw, indexed?.calibrations ?? []);
      const metrics: PositionMetrics | undefined = perp
        ? positionMetrics({
            side,
            lotLNS: p.lotLNS,
            entryPricePNS: p.entryPricePNS,
            markPricePNS: p.markPricePNS,
            depositCNS: p.depositCNS,
            priceDecimals: Number(perp.priceDecimals),
            lotDecimals: Number(perp.lotDecimals),
            collateralDecimals: view.collateral.decimals,
            maintenanceFraction: marginFractionFromRaw(cfg?.maintenanceMarginRaw),
          })
        : undefined;
      const decimalsMismatch =
        !!perp &&
        !!cfg &&
        (Number(perp.priceDecimals) !== cfg.priceDecimals || Number(perp.lotDecimals) !== cfg.sizeDecimals);
      return { p, side, metrics, decimalsMismatch };
    });
  }, [view, contextById, indexed]);

  const summary = useMemo(
    () => portfolioSummary(rows.filter(r => r.metrics).map(r => ({ side: r.side, metrics: r.metrics! }))),
    [rows],
  );

  // Only the owner of the watched account, signed in with Mera, can close; the worker re-verifies everything.
  const canClose = !!account && !!walletClient && !!view && view.owner === account.address;

  const closePosition = async (p: OnChainPosition) => {
    if (!canClose || !view || !account || !walletClient) return;
    setClosing(p.market);
    setCloseResult(undefined);
    try {
      const message = {
        owner: account.address,
        account: view.address,
        perpId: p.perpId,
        nonce: BigInt(Date.now()),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      };
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: CLOSE_APPROVAL_TYPES,
        primaryType: "ClosePosition",
        message,
      });
      const wire = Object.fromEntries(
        Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
      );
      const r = await worker.close({ approval: { message: wire, signature } });
      setCloseResult(
        `${p.market}: ${String(r.mode)} · ${String(r.status)} · lado ${String(r.side)} (${String(r.sideSource)})` +
          (r.txHash ? ` · tx ${String(r.txHash)}` : "") +
          (r.error ? ` · ${String(r.error)}` : ""),
      );
      void readAccount();
    } catch (e) {
      setCloseResult(`${p.market}: ${(e as Error).message}`);
    } finally {
      setClosing(undefined);
    }
  };

  const coll = (v: bigint) => (view ? `${formatUnits(v, view.collateral.decimals)} ${view.collateral.symbol}` : "—");
  const staleSec = market.lastUpdate ? Math.round((Date.now() - market.lastUpdate) / 1000) : null;

  return (
    <div className="flex flex-col grow pt-8 px-4 gap-5 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Riesgo</h1>
        <span className="text-xs opacity-70">
          WS {market.status} · bloque {market.headBlock ?? "—"} · gaps heartbeat {market.gaps}
          {staleSec !== null && ` · precios hace ${staleSec}s`}
        </span>
      </div>
      {market.subErrors.length > 0 && <p className="text-error text-sm">Suscripción: {market.subErrors.join("; ")}</p>}
      {contextError && <p className="text-warning text-sm">Config de mercados no disponible: {contextError}</p>}

      <section className="card bg-base-100 shadow p-4 gap-2 overflow-x-auto">
        <h2 className="font-semibold">Mercados (Perpl testnet, en vivo)</h2>
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Mercado</th>
              <th>Mark</th>
              <th>Oráculo</th>
              <th>Mark−oráculo</th>
              <th>Spread</th>
              <th>24h</th>
              <th>OI</th>
              <th>MM</th>
            </tr>
          </thead>
          <tbody>
            {MARKET_SYMBOLS.map(sym => {
              const id = Number(PERPL_TESTNET.markets[sym]);
              const st = market.states[String(id)];
              const cfg = contextById.get(id);
              const r = st && cfg ? marketRow(st, cfg.priceDecimals, cfg.sizeDecimals) : undefined;
              const mm = marginFractionFromRaw(cfg?.maintenanceMarginRaw);
              return (
                <tr key={sym}>
                  <td>{sym}</td>
                  <td>{fmt(r?.mark)}</td>
                  <td>{fmt(r?.oracle)}</td>
                  <td className={r?.markOracleDevBps && Math.abs(r.markOracleDevBps) > 50 ? "text-warning" : ""}>
                    {fmt(r?.markOracleDevBps, 1)} bps
                  </td>
                  <td>{fmt(r?.spreadBps, 1)} bps</td>
                  <td>{fmt(r?.change24hPct)}%</td>
                  <td>{fmt(r?.openInterest, 4)}</td>
                  <td>{mm === null ? "—" : `${fmt(mm * 100)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card bg-base-100 shadow p-4 gap-3">
        <h2 className="font-semibold">Cuenta</h2>
        <input
          className="input input-bordered input-sm font-mono"
          placeholder="Dirección de DelegatedAccount (o inicia sesión en Cuenta)"
          defaultValue={target}
          onBlur={e => isAddress(e.target.value) && setTarget(e.target.value)}
          aria-label="Cuenta a monitorear"
        />
        {readError && <p className="text-error text-sm">Lectura on-chain falló: {readError}</p>}
        {view && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="opacity-60">Balance exchange</div>
              <div>{coll(view.balanceCNS)}</div>
            </div>
            <div>
              <div className="opacity-60">Bloqueado</div>
              <div>{coll(view.lockedBalanceCNS)}</div>
            </div>
            <div>
              <div className="opacity-60">Exposición long / short</div>
              <div>
                {fmt(summary.longNotionalUsd)} / {fmt(summary.shortNotionalUsd)} USD
              </div>
            </div>
            <div>
              <div className="opacity-60">PnL no realizado (est.)</div>
              <div>{fmt(summary.totalUnrealizedPnlUsd)} USD</div>
            </div>
            <div>
              <div className="opacity-60">Nocional total</div>
              <div>{fmt(summary.totalNotionalUsd)} USD</div>
            </div>
            <div>
              <div className="opacity-60">Concentración máx.</div>
              <div>{summary.concentration === null ? "—" : `${fmt(summary.concentration * 100)}%`}</div>
            </div>
            <div>
              <div className="opacity-60">Colchón mínimo vs MM (est.)</div>
              <div
                className={
                  summary.minMaintenanceBufferPct !== null && summary.minMaintenanceBufferPct < BUFFER_WARN_PCT
                    ? "text-error font-semibold"
                    : ""
                }
              >
                {summary.minMaintenanceBufferPct === null ? "—" : `${fmt(summary.minMaintenanceBufferPct)} pp`}
              </div>
            </div>
            <div>
              <div className="opacity-60">Leído on-chain</div>
              <div>{new Date(view.readAt).toLocaleTimeString()}</div>
            </div>
          </div>
        )}
      </section>

      {view && (
        <section className="card bg-base-100 shadow p-4 gap-2 overflow-x-auto">
          <h2 className="font-semibold">Posiciones</h2>
          {rows.length === 0 ? (
            <p className="text-sm opacity-70">Sin posiciones abiertas.</p>
          ) : (
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Lado</th>
                  <th>Tamaño</th>
                  <th>Entrada</th>
                  <th>Mark</th>
                  <th>Colateral</th>
                  <th>PnL est.</th>
                  <th>Apal. efectivo</th>
                  <th>Liq. est.</th>
                  {canClose && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, side, metrics: m, decimalsMismatch }) => (
                  <tr key={p.market}>
                    <td>
                      {p.market}
                      {decimalsMismatch && <span className="text-warning"> ⚠ decimales</span>}
                    </td>
                    <td>{side === "unknown" ? `? (raw ${p.positionTypeRaw})` : side}</td>
                    <td>{fmt(m?.size, 6)}</td>
                    <td>{fmt(m?.entryPrice)}</td>
                    <td>
                      {fmt(m?.markPrice)}
                      {!p.markPriceValid && <span className="text-warning"> (inválido)</span>}
                    </td>
                    <td>{fmt(m?.collateralUsd)}</td>
                    <td>{fmt(m?.unrealizedPnlUsd)}</td>
                    <td>{m?.effectiveLeverage ? `${fmt(m.effectiveLeverage)}x` : "—"}</td>
                    <td>{fmt(m?.estLiquidationPrice)}</td>
                    {canClose && (
                      <td>
                        <button
                          className="btn btn-xs btn-outline"
                          disabled={!!closing}
                          onClick={() => closePosition(p)}
                        >
                          {closing === p.market ? "Cerrando…" : "Cerrar"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {closeResult && <p className="text-sm break-all">{closeResult}</p>}
          <p className="text-xs opacity-60">
            Estimaciones sin funding ni fees; Perpl no publica su fórmula de margen. MM = 100 / maintenance_margin según
            los ejemplos de la documentación. El lado se obtiene del indexador (orden de apertura en la misma
            transacción); sin indexador se muestra el valor raw.
          </p>
        </section>
      )}

      <section className="card bg-base-100 shadow p-4 gap-2">
        <h2 className="font-semibold">Decisiones del agente</h2>
        {!decisions ? (
          <p className="text-sm opacity-70">Worker no disponible.</p>
        ) : decisions.length === 0 ? (
          <p className="text-sm opacity-70">Sin decisiones para esta cuenta.</p>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {decisions.slice(0, 10).map((d, i) => (
              <li key={i} className="font-mono break-all">
                {String(d.ts)} · {String(d.mode)} · {String(d.status)} · plan {String(d.planHash).slice(0, 10)}…
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card bg-base-100 shadow p-4 gap-2">
        <h2 className="font-semibold">Historial (Envio)</h2>
        {!INDEXER_URL ? (
          <p className="text-sm opacity-70">Indexador no configurado (NEXT_PUBLIC_INDEXER_URL).</p>
        ) : indexerError ? (
          <p className="text-error text-sm">{indexerError}</p>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {(indexed?.events ?? []).map(e => (
              <li key={e.id} className="font-mono break-all">
                #{e.block} · {e.kind}
                {e.side ? ` · ${e.side}` : ""}
                {e.perpId ? ` · perp ${e.perpId}` : ""} · {e.txHash.slice(0, 10)}…
              </li>
            ))}
            {indexed?.events.length === 0 && <li>Sin eventos indexados.</li>}
          </ul>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
