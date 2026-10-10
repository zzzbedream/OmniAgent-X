import type { CompiledMandate } from "@omniagent/core";

type Props = {
  compiled: CompiledMandate;
  addCollateralEnabled: boolean | undefined;
};

/** What the user is about to sign: the deterministic rendering of the mandate, never the model's prose. */
export function MandatePreview({ compiled, addCollateralEnabled }: Props) {
  const m = compiled.mandate;
  const hasTopUps = m.rules.some(r => r.action.type === "addCollateral");
  return (
    <section className="panel p-4 gap-3">
      <h2 className="font-semibold">What you are about to sign</h2>
      <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
        {compiled.lines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="text-xs text-smoke">
        Markets: {m.markets.join(", ")} · wait between actions: {Math.round(m.cooldownSec / 60)} min · at most{" "}
        {m.maxActionsPerDay} actions per day · collateral budget: {m.collateralBudgetUsd} USD. Closing ignores the wait
        and the daily limit. The guardian never opens positions or withdraws funds.
      </p>
      {compiled.assumptions.length > 0 && (
        <div className="flex flex-col items-start gap-1 rounded-md border border-signal/30 bg-signal/10 px-3 py-2 text-sm">
          <span className="font-semibold">The model assumed:</span>
          {compiled.assumptions.map(a => (
            <span key={a}>• {a}</span>
          ))}
        </div>
      )}
      {compiled.unsupported.length > 0 && (
        <div className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber text-sm flex-col items-start">
          <span className="font-semibold">Cannot be done (ignored):</span>
          {compiled.unsupported.map(u => (
            <span key={u}>• {u}</span>
          ))}
        </div>
      )}
      {compiled.violations.length > 0 && (
        <div className="flex flex-col items-start gap-1 rounded-md border border-short/30 bg-short/10 px-3 py-2 text-sm text-short">
          {compiled.violations.map(v => (
            <span key={v.detail}>• {v.detail}</span>
          ))}
        </div>
      )}
      {hasTopUps && addCollateralEnabled === false && (
        <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber text-sm">
          Collateral top-ups are disabled on this agent: those rules will not run for now.
        </p>
      )}
      <p className="text-xs opacity-50 break-all">
        Mandate hash: {compiled.mandateHash} · {compiled.telemetry.model} {compiled.telemetry.latencyMs} ms
      </p>
    </section>
  );
}
