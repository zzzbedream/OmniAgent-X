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
    <section className="card bg-base-100 shadow p-4 gap-3">
      <h2 className="font-semibold">Lo que vas a firmar</h2>
      <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
        {compiled.lines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="text-xs opacity-70">
        Mercados: {m.markets.join(", ")} · espera entre acciones: {Math.round(m.cooldownSec / 60)} min · máximo{" "}
        {m.maxActionsPerDay} acciones por día · presupuesto de colateral: {m.collateralBudgetUsd} USD. Cerrar ignora la
        espera y el máximo diario. El guardián nunca abre posiciones ni retira fondos.
      </p>
      {compiled.assumptions.length > 0 && (
        <div className="alert alert-info text-sm flex-col items-start">
          <span className="font-semibold">El modelo asumió:</span>
          {compiled.assumptions.map(a => (
            <span key={a}>• {a}</span>
          ))}
        </div>
      )}
      {compiled.unsupported.length > 0 && (
        <div className="alert alert-warning text-sm flex-col items-start">
          <span className="font-semibold">No se puede hacer (se ignora):</span>
          {compiled.unsupported.map(u => (
            <span key={u}>• {u}</span>
          ))}
        </div>
      )}
      {compiled.violations.length > 0 && (
        <div className="alert alert-error text-sm flex-col items-start">
          {compiled.violations.map(v => (
            <span key={v.detail}>• {v.detail}</span>
          ))}
        </div>
      )}
      {hasTopUps && addCollateralEnabled === false && (
        <p className="alert alert-warning text-sm">
          Las recargas de colateral están desactivadas en este agente: esas reglas no se ejecutarán por ahora.
        </p>
      )}
      <p className="text-xs opacity-50 break-all">
        Hash del mandato: {compiled.mandateHash} · {compiled.telemetry.model} {compiled.telemetry.latencyMs} ms
      </p>
    </section>
  );
}
