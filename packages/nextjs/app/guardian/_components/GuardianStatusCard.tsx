import { SKIP_REASON_TEXT } from "@omniagent/core";
import type { GuardianStatus } from "~~/lib/omni/worker";

type Props = {
  status: GuardianStatus;
  isRevoking: boolean;
  onRevoke: () => void;
};

const time = (sec: number) => new Date(sec * 1000).toLocaleString();

export function GuardianStatusCard({ status, isRevoking, onRevoke }: Props) {
  if (!status.active) {
    return (
      <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ash">
        El guardián no está activo en esta cuenta. Escribe tus reglas abajo para activarlo.
      </p>
    );
  }
  const tick = status.lastTick;
  return (
    <section className="panel p-4 gap-3 border border-long/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Guardián activo</h2>
        <span className={status.mode === "live" ? "chip-live" : "chip-sim"}>
          {status.mode === "live" ? "en vivo" : "simulación (no envía transacciones)"}
        </span>
      </div>
      <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
        {(status.lines ?? []).map(line => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="text-xs text-smoke">
        Vence {status.expiresAt ? time(status.expiresAt) : "—"} · acciones hoy: {status.state?.actionsToday ?? 0}/
        {status.mandate?.maxActionsPerDay ?? "—"} · colateral usado: {status.state?.collateralAddedUsd ?? 0}/
        {status.mandate?.collateralBudgetUsd ?? 0} USD
      </p>
      {tick && (
        <div className="text-xs flex flex-col gap-1">
          <span className="text-smoke">Última revisión: {time(tick.at)}</span>
          {tick.error && <span className="text-short">{tick.error}</span>}
          {tick.skipped.map(s => (
            <span key={s.market}>
              {s.market}: {SKIP_REASON_TEXT[s.reason] ?? s.reason}
            </span>
          ))}
        </div>
      )}
      <button className="btn btn-outline btn-error btn-sm self-start" disabled={isRevoking} onClick={onRevoke}>
        {isRevoking ? "Firmando…" : "Revocar con passkey"}
      </button>
    </section>
  );
}
