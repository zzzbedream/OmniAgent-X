// Plain-language (Spanish, like the PWA) rendering of mandates and guardian decisions. Deterministic
// templates: the explanation of an action never depends on a model.
import type { GuardianAction, SkipReason } from "./engine";
import type { GuardianActionSpec, GuardianMandate, GuardianTrigger } from "./mandate";

const num = (x: number) => String(Number(x.toFixed(2)));

function triggerCondition(t: GuardianTrigger): string {
  switch (t.kind) {
    case "liquidationBuffer":
      return `Si la distancia a liquidación baja de ${num(t.belowPct)}%`;
    case "drawdown":
      return `Si la pérdida llega a ${num(t.lossPct)}% del colateral`;
    case "maxLeverage":
      return `Si el apalancamiento supera ${num(t.above)}x`;
  }
}

function actionInfinitive(a: GuardianActionSpec): string {
  switch (a.type) {
    case "addCollateral":
      return `agregar ${num(a.usd)} USD de colateral`;
    case "reduce":
      return `reducir la posición ${num(a.fraction * 100)}%`;
    case "close":
      return "cerrar la posición";
  }
}

/** One line per rule, in mandate order, for the preview the user signs. */
export function describeMandate(m: GuardianMandate): string[] {
  return m.rules.map(r => `${triggerCondition(r.trigger)}: ${actionInfinitive(r.action)}.`);
}

function because(hit: GuardianAction["hit"]): string {
  const t = hit.trigger;
  switch (t.kind) {
    case "liquidationBuffer":
      return `la distancia a liquidación (${hit.observed.toFixed(1)}%) bajó de ${num(t.belowPct)}%`;
    case "drawdown":
      return `la pérdida (${hit.observed.toFixed(1)}% del colateral) llegó a ${num(t.lossPct)}%`;
    case "maxLeverage":
      return `el apalancamiento (${hit.observed.toFixed(2)}x) superó ${num(t.above)}x`;
  }
}

function verb(a: GuardianAction, dryRun: boolean): string {
  switch (a.type) {
    case "addCollateral":
      return `${dryRun ? "agregaría" : "agregué"} ${num(a.usd)} USD de colateral`;
    case "reduce":
      return `${dryRun ? "reduciría" : "reduje"} la posición ${num(a.fraction * 100)}%`;
    case "close":
      return `${dryRun ? "cerraría" : "cerré"} la posición`;
  }
}

/** Explanation for the action feed. `dryRun` switches to the conditional voice ("would have"). */
export function describeGuardianAction(a: GuardianAction, opts: { dryRun: boolean }): string {
  return `${a.market}: ${verb(a, opts.dryRun)} porque ${because(a.hit)}.`;
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  notCovered: "el mandato no cubre este mercado",
  unknownSide: "no se conoce el lado de la posición (no fue abierta por la app)",
  invalidMark: "el precio mark no es válido en este momento",
  metricsUnavailable: "faltan datos para evaluar las reglas (margen de mantenimiento)",
  cooldown: "en espera: la última acción fue hace menos del cooldown",
  dailyCap: "se alcanzó el máximo de acciones del día",
  collateralBudget: "se agotó el presupuesto de colateral del mandato",
  tooSmall: "la posición es demasiado chica para reducirla",
};
