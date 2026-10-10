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
        The guardian is not active on this account. Write your rules below to activate it.
      </p>
    );
  }
  const tick = status.lastTick;
  return (
    <section className="panel p-4 gap-3 border border-long/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Guardian active</h2>
        <span className={status.mode === "live" ? "chip-live" : "chip-sim"}>
          {status.mode === "live" ? "live" : "simulation (sends no transactions)"}
        </span>
      </div>
      <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
        {(status.lines ?? []).map(line => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="text-xs text-smoke">
        Expires {status.expiresAt ? time(status.expiresAt) : "—"} · actions today: {status.state?.actionsToday ?? 0}/
        {status.mandate?.maxActionsPerDay ?? "—"} · collateral used: {status.state?.collateralAddedUsd ?? 0}/
        {status.mandate?.collateralBudgetUsd ?? 0} USD
      </p>
      {tick && (
        <div className="text-xs flex flex-col gap-1">
          <span className="text-smoke">Last check: {time(tick.at)}</span>
          {tick.error && <span className="text-short">{tick.error}</span>}
          {tick.skipped.map(s => (
            <span key={s.market}>
              {s.market}: {SKIP_REASON_TEXT[s.reason] ?? s.reason}
            </span>
          ))}
        </div>
      )}
      <button className="btn btn-outline btn-error btn-sm self-start" disabled={isRevoking} onClick={onRevoke}>
        {isRevoking ? "Signing…" : "Revoke with passkey"}
      </button>
    </section>
  );
}
