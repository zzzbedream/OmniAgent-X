"use client";

import { useState } from "react";
import {
  type GuardianMandate,
  type PositionInput,
  SKIP_REASON_TEXT,
  type SimStep,
  describeGuardianAction,
  simulateShock,
} from "@omniagent/core";

type Props = {
  mandate: GuardianMandate | undefined;
  /** Maintenance margin as a fraction from Perpl's context; null when unknown. */
  maintenanceFraction: number | null;
};

// Hypothetical BTC position in Perpl's testnet units (price 1 decimal, size 5, AUSD 6).
const REFERENCE_PRICE = 80_000;
const FALLBACK_MAINTENANCE = 0.04;

function buildPosition(side: "long" | "short", notionalUsd: number, collateralUsd: number, mm: number): PositionInput {
  return {
    side,
    lotLNS: BigInt(Math.round((notionalUsd / REFERENCE_PRICE) * 1e5)),
    entryPricePNS: BigInt(REFERENCE_PRICE * 10),
    markPricePNS: BigInt(REFERENCE_PRICE * 10),
    depositCNS: BigInt(Math.round(collateralUsd * 1e6)),
    priceDecimals: 1,
    lotDecimals: 5,
    collateralDecimals: 6,
    maintenanceFraction: mm,
  };
}

/** Replays an adverse price path with the same engine the worker runs. No transaction is sent. */
export function ShockSimulator({ mandate, maintenanceFraction }: Props) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [notional, setNotional] = useState("800");
  const [collateral, setCollateral] = useState("120");
  const [shockPct, setShockPct] = useState("12");
  const [steps, setSteps] = useState<SimStep[]>();
  const [err, setErr] = useState<string>();

  const mm = maintenanceFraction ?? FALLBACK_MAINTENANCE;

  const run = () => {
    setErr(undefined);
    try {
      if (!mandate) throw new Error("primero traduce o activa un mandato");
      const n = Number(notional);
      const c = Number(collateral);
      const shock = Number(shockPct) / 100;
      if (!(n > 0 && c > 0 && shock > 0 && shock < 0.9)) throw new Error("revisa los valores (shock entre 0 y 90%)");
      const direction = side === "long" ? -1 : 1; // adverse move
      const count = 10;
      const path = Array.from({ length: count }, (_, i) => (direction * shock * (i + 1)) / count);
      setSteps(
        simulateShock({
          mandate,
          market: "BTC",
          position: buildPosition(side, n, c, mm),
          path,
          // One step per cooldown, so every step is allowed to act.
          stepSec: mandate.cooldownSec,
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <section className="card bg-base-100 shadow p-4 gap-3">
      <h2 className="font-semibold">Simular un shock</h2>
      <p className="text-xs opacity-70">
        Posición hipotética en BTC (precio de referencia {REFERENCE_PRICE.toLocaleString()} USD). Margen de
        mantenimiento {(mm * 100).toFixed(2)}%
        {maintenanceFraction === null ? " (supuesto: Perpl no respondió)" : " (de Perpl)"}. Es una estimación: ignora
        funding y fees, y al reducir deja el colateral en la posición más chica.
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="form-control">
          <span>Lado</span>
          <select
            className="select select-bordered select-sm"
            value={side}
            onChange={e => setSide(e.target.value as "long" | "short")}
          >
            <option value="long">Largo</option>
            <option value="short">Corto</option>
          </select>
        </label>
        <label className="form-control">
          <span>Shock en contra (%)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={shockPct}
            onChange={e => setShockPct(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span>Nocional (USD)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={notional}
            onChange={e => setNotional(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span>Colateral (USD)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={collateral}
            onChange={e => setCollateral(e.target.value)}
          />
        </label>
      </div>
      <button className="btn btn-secondary btn-sm self-start" disabled={!mandate} onClick={run}>
        Simular
      </button>
      {err && <p className="text-error text-sm">{err}</p>}
      {steps && (
        <ol className="text-sm flex flex-col gap-1">
          {steps.map(s => (
            <li key={s.t}>
              <span className="opacity-60">
                {(s.move * 100).toFixed(1)}% → {s.markPrice.toLocaleString()} USD · distancia{" "}
                {s.bufferPct === null ? "—" : `${s.bufferPct.toFixed(1)}%`}:{" "}
              </span>
              {s.action
                ? describeGuardianAction(s.action, { dryRun: true })
                : s.skipped.map(k => SKIP_REASON_TEXT[k.reason]).join("; ") || "sin acción"}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
