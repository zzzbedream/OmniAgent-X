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
  type SideLogEntry,
  marginFractionFromRaw,
  marketRow,
  portfolioSummary,
  positionMetrics,
  readCollateral,
  readDelegatedAccount,
  readPerpSnapshot,
  readPositions,
  sideFromDecisionLog,
} from "@omniagent/core";
import type { NextPage } from "next";
import { type Address, formatUnits, isAddress } from "viem";
import { useMarketData } from "~~/hooks/omni/useMarketData";
import { resolveDelegatedAccount } from "~~/lib/omni/account";
import { type Calibration, INDEXER_URL, type IndexedEvent, fetchIndexed, sideForRaw } from "~~/lib/omni/indexer";
import { worker } from "~~/lib/omni/worker";
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
  const { account, walletClient, confirm } = useMera();
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
    if (q && isAddress(q)) return setTarget(q);
    if (!account) return;
    let cancelled = false;
    void resolveDelegatedAccount(account.address).then(r => !cancelled && setTarget(r?.address));
    return () => {
      cancelled = true;
    };
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
      // Side only from verified sources: the indexer's calibration, else the worker's own log of the open it sent.
      const fromIndexer = sideForRaw(p.positionTypeRaw, indexed?.calibrations ?? []);
      const fromWorker = sideFromDecisionLog((decisions ?? []) as SideLogEntry[], view.address, p.perpId, "live");
      const side: "long" | "short" | "unknown" = fromIndexer !== "unknown" ? fromIndexer : (fromWorker ?? "unknown");
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
  }, [view, contextById, indexed, decisions]);

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
      // Fingerprint / Face ID before the agent closes anything.
      await confirm();
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

  const pnl = summary.totalUnrealizedPnlUsd;
  // Colour by sign only when there is a number; null means no position has computable metrics.
  const signTone = (n: number | null | undefined) =>
    n === null || n === undefined ? "text-smoke" : n > 0 ? "text-long" : n < 0 ? "text-short" : "text-bone";
  // Below a cent the sign is noise: show 0.00, not "-0".
  const signed = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return fmt(n);
    const v = Math.abs(n) < 0.005 ? 0 : n;
    return (v > 0 ? "+" : "") + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const isBufferLow = summary.minMaintenanceBufferPct !== null && summary.minMaintenanceBufferPct < BUFFER_WARN_PCT;

  return (
    <div className="mx-auto flex w-full max-w-[560px] grow flex-col gap-5 px-4 pt-6 lg:max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-bold tracking-tight">Riesgo</h1>
          <p className="text-sm text-ash">
            Posiciones leídas on-chain, precios en vivo de Perpl y lo que hizo el agente.
          </p>
        </div>
        <span className="num flex items-center gap-1.5 text-[11px] text-smoke">
          <span
            className={`h-1.5 w-1.5 rounded-full ${market.status === "open" ? "animate-pulse bg-long" : "bg-amber"}`}
            aria-hidden
          />
          WS {market.status} · bloque {market.headBlock ?? "—"}
          {staleSec !== null && ` · ${staleSec}s`}
        </span>
      </header>
      {market.subErrors.length > 0 && <p className="text-sm text-short">Suscripción: {market.subErrors.join("; ")}</p>}
      {contextError && <p className="text-sm text-amber">Config de mercados no disponible: {contextError}</p>}

      <input
        className="input input-bordered input-sm num w-full bg-raised"
        placeholder="Dirección de DelegatedAccount (o inicia sesión en Cuenta)"
        defaultValue={target}
        onBlur={e => isAddress(e.target.value) && setTarget(e.target.value)}
        aria-label="Cuenta a monitorear"
      />
      {readError && <p className="text-sm text-short">Lectura on-chain falló: {readError}</p>}

      {view && (
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Resumen de la cuenta">
          <div className="panel col-span-2 flex flex-col justify-between gap-3 p-4 lg:row-span-2">
            <span className="label-caps">PnL no realizado (est.)</span>
            <span className={`num text-[40px] font-semibold leading-none tracking-tight ${signTone(pnl)}`}>
              {signed(pnl)} <span className="text-base text-smoke">USD</span>
            </span>
            <span className="num text-xs text-smoke">
              {rows.length} {rows.length === 1 ? "posición" : "posiciones"} · leído{" "}
              {new Date(view.readAt).toLocaleTimeString()}
            </span>
          </div>
          <Tile label="Balance exchange" value={coll(view.balanceCNS)} />
          <Tile label="Bloqueado" value={coll(view.lockedBalanceCNS)} />
          <Tile label="Largo / corto" value={`${fmt(summary.longNotionalUsd)} / ${fmt(summary.shortNotionalUsd)}`} />
          <Tile
            label="Colchón vs MM (est.)"
            value={summary.minMaintenanceBufferPct === null ? "—" : `${fmt(summary.minMaintenanceBufferPct)} pp`}
            tone={isBufferLow ? "short" : undefined}
          />
        </section>
      )}

      {view && (
        <section className="flex flex-col gap-2" aria-label="Posiciones">
          <h2 className="label-caps">Posiciones</h2>
          {rows.length === 0 ? (
            <p className="panel p-4 text-sm text-ash">Sin posiciones abiertas.</p>
          ) : (
            rows.map(({ p, side, metrics: m, decimalsMismatch }) => {
              const rowPnl = m?.unrealizedPnlUsd;
              return (
                <article key={p.market} className="panel flex flex-col gap-3 p-4">
                  <header className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold">{p.market}-PERP</span>
                      {side === "long" ? (
                        <span className="chip-long">Largo</span>
                      ) : side === "short" ? (
                        <span className="chip-short">Corto</span>
                      ) : (
                        <span className="chip-muted">Lado ? (raw {p.positionTypeRaw})</span>
                      )}
                      {decimalsMismatch && <span className="chip-sim">decimales</span>}
                    </span>
                    <span className={`num text-lg font-semibold ${signTone(rowPnl)}`}>{signed(rowPnl)}</span>
                  </header>
                  <dl className="num grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                    <Cell label="Tamaño" value={fmt(m?.size, 6)} />
                    <Cell label="Entrada" value={fmt(m?.entryPrice)} />
                    <Cell label="Mark" value={`${fmt(m?.markPrice)}${p.markPriceValid ? "" : " ⚠"}`} />
                    <Cell label="Colateral" value={fmt(m?.collateralUsd)} />
                    <Cell label="Apal. efectivo" value={m?.effectiveLeverage ? `${fmt(m.effectiveLeverage)}x` : "—"} />
                    <Cell label="Liq. est." value={fmt(m?.estLiquidationPrice)} tone="amber" />
                  </dl>
                  {canClose && (
                    <button
                      className="btn btn-outline btn-sm border-short/50 text-short hover:border-short hover:bg-short/10"
                      disabled={!!closing}
                      onClick={() => closePosition(p)}
                    >
                      {closing === p.market ? "Confirma con tu huella…" : "Cerrar con passkey"}
                    </button>
                  )}
                </article>
              );
            })
          )}
          {closeResult && (
            <p className="num rounded-md border border-line bg-raised p-3 text-xs break-all text-ash">{closeResult}</p>
          )}
          <p className="text-[11px] text-smoke">
            Estimaciones sin funding ni fees; Perpl no publica su fórmula de margen. MM = 100 / maintenance_margin según
            los ejemplos de la documentación. El lado sale del indexador o del log del worker que abrió la posición;
            nunca se adivina.
          </p>
        </section>
      )}

      <section className="panel flex flex-col gap-2 overflow-x-auto p-4" aria-label="Mercados">
        <h2 className="label-caps">Mercados · Perpl testnet en vivo</h2>
        <table className="num w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="text-left text-[11px] text-smoke">
              <th className="py-1.5 font-medium">Mercado</th>
              <th className="py-1.5 font-medium">Mark</th>
              <th className="hidden py-1.5 font-medium sm:table-cell">Mark−orác.</th>
              <th className="py-1.5 font-medium">Spread</th>
              <th className="py-1.5 font-medium">24h</th>
              <th className="py-1.5 font-medium">MM</th>
            </tr>
          </thead>
          <tbody>
            {MARKET_SYMBOLS.map(sym => {
              const id = Number(PERPL_TESTNET.markets[sym]);
              const st = market.states[String(id)];
              const cfg = contextById.get(id);
              const r = st && cfg ? marketRow(st, cfg.priceDecimals, cfg.sizeDecimals) : undefined;
              const mm = marginFractionFromRaw(cfg?.maintenanceMarginRaw);
              const change = r?.change24hPct;
              return (
                <tr key={sym} className="border-t border-line">
                  <td className="py-2 font-semibold">{sym}</td>
                  <td className="py-2">{fmt(r?.mark)}</td>
                  <td
                    className={`hidden py-2 sm:table-cell ${r?.markOracleDevBps && Math.abs(r.markOracleDevBps) > 50 ? "text-amber" : "text-ash"}`}
                  >
                    {fmt(r?.markOracleDevBps, 1)} bps
                  </td>
                  <td className="py-2 text-ash">{fmt(r?.spreadBps, 1)} bps</td>
                  <td
                    className={`py-2 ${change && change > 0 ? "text-long" : change && change < 0 ? "text-short" : "text-ash"}`}
                  >
                    {fmt(change)}%
                  </td>
                  <td className="py-2 text-ash">{mm === null ? "—" : `${fmt(mm * 100)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel flex flex-col gap-3 p-4" aria-label="Decisiones del agente">
        <h2 className="label-caps">Decisiones del agente</h2>
        {!decisions ? (
          <p className="text-sm text-ash">Worker no disponible.</p>
        ) : decisions.length === 0 ? (
          <p className="text-sm text-ash">Sin decisiones para esta cuenta.</p>
        ) : (
          <ol className="flex flex-col">
            {decisions.slice(0, 10).map((d, i) => (
              <li key={i} className="flex items-start gap-3 border-l border-line pb-3 pl-3 last:pb-0">
                <span
                  className={`-ml-[17px] mt-1 h-2 w-2 shrink-0 rounded-full ${
                    d.status === "sent" || d.status === "active"
                      ? "bg-long"
                      : d.status === "rejected" || d.status === "failed"
                        ? "bg-short"
                        : "bg-amber"
                  }`}
                  aria-hidden
                />
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{String(d.kind)}</span>
                    <span className={d.mode === "live" ? "chip-live" : "chip-sim"}>
                      {d.mode === "live" ? "En vivo" : "Simulación"}
                    </span>
                    <span className="chip-muted">{String(d.status)}</span>
                  </span>
                  <span className="num text-[11px] text-smoke">
                    {new Date(String(d.ts)).toLocaleString()} · {String(d.planHash).slice(0, 12)}…
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel flex flex-col gap-2 p-4" aria-label="Historial indexado">
        <h2 className="label-caps">Historial · Envio</h2>
        {!INDEXER_URL ? (
          <p className="text-sm text-ash">Indexador no configurado (NEXT_PUBLIC_INDEXER_URL).</p>
        ) : indexerError ? (
          <p className="text-sm text-short">{indexerError}</p>
        ) : (
          <ul className="num flex flex-col gap-1 text-xs text-ash">
            {(indexed?.events ?? []).map(e => (
              <li key={e.id} className="break-all">
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

const Tile = ({ label, value, tone }: { label: string; value: string; tone?: "short" }) => (
  <div className="panel flex flex-col gap-1 p-3">
    <span className="label-caps">{label}</span>
    <span className={`num text-sm ${tone === "short" ? "font-semibold text-short" : "text-bone"}`}>{value}</span>
  </div>
);

const Cell = ({ label, value, tone }: { label: string; value: string; tone?: "amber" }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[11px] text-smoke">{label}</dt>
    <dd className={tone === "amber" ? "text-amber" : "text-bone"}>{value}</dd>
  </div>
);

export default Dashboard;
