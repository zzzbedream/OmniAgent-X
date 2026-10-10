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
      if (!mandate) throw new Error("first translate or activate a mandate");
      const n = Number(notional);
      const c = Number(collateral);
      const shock = Number(shockPct) / 100;
      if (!(n > 0 && c > 0 && shock > 0 && shock < 0.9)) throw new Error("check the values (shock between 0 and 90%)");
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
    <section className="panel p-4 gap-3">
      <h2 className="font-semibold">Simulate a shock</h2>
      <p className="text-xs text-smoke">
        Hypothetical BTC position (reference price {REFERENCE_PRICE.toLocaleString()} USD). Maintenance margin{" "}
        {(mm * 100).toFixed(2)}%{maintenanceFraction === null ? " (assumed: Perpl did not answer)" : " (from Perpl)"}.
        An estimate: it ignores funding and fees, and a reduction leaves the collateral in the smaller position.
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="form-control">
          <span>Side</span>
          <select
            className="select select-bordered w-full bg-raised select-sm"
            value={side}
            onChange={e => setSide(e.target.value as "long" | "short")}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label className="form-control">
          <span>Adverse shock (%)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={shockPct}
            onChange={e => setShockPct(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span>Notional (USD)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={notional}
            onChange={e => setNotional(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span>Collateral (USD)</span>
          <input
            className="input input-bordered input-sm"
            inputMode="decimal"
            value={collateral}
            onChange={e => setCollateral(e.target.value)}
          />
        </label>
      </div>
      <button className="btn btn-outline btn-sm self-start border-line" disabled={!mandate} onClick={run}>
        Simulate
      </button>
      {err && <p className="text-short text-sm">{err}</p>}
      {steps && (
        <ol className="text-sm flex flex-col gap-1">
          {steps.map(s => (
            <li key={s.t}>
              <span className="text-smoke">
                {(s.move * 100).toFixed(1)}% → {s.markPrice.toLocaleString()} USD · distance{" "}
                {s.bufferPct === null ? "—" : `${s.bufferPct.toFixed(1)}%`}:{" "}
              </span>
              {s.action
                ? describeGuardianAction(s.action, { dryRun: true })
                : s.skipped.map(k => SKIP_REASON_TEXT[k.reason]).join("; ") || "no action"}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
