import { DEFAULT_TESTNET_POLICY, type RiskReport } from "@omniagent/core";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { fmtUsd } from "~~/components/omni/format";

const P = DEFAULT_TESTNET_POLICY;

/** Each row maps to the violation codes the deterministic RiskPolicy (core/strategy/risk.ts) can emit. */
const RULES: readonly { label: string; codes: readonly string[] }[] = [
  { label: `Allowed markets (${P.allowedMarkets.join(" · ")})`, codes: ["market"] },
  { label: `Leverage ≤ ${P.maxLeverage}x`, codes: ["maxLeverage"] },
  {
    label: `Notional per order between ${P.minOrderNotionalUsd} and ${P.maxOrderNotionalUsd} USD`,
    codes: ["minOrderNotional", "maxOrderNotional"],
  },
  { label: `Max ${P.maxOrders} orders, one per market`, codes: ["maxOrders", "duplicateMarket", "orders"] },
  { label: "Required margin ≤ budget", codes: ["budget"] },
];

export const RulesChecklist = ({ risk, budgetUsd }: { risk: RiskReport; budgetUsd: number }) => {
  const rows = RULES.map(rule => ({
    ...rule,
    failures: risk.violations.filter(v => rule.codes.includes(v.rule)),
  }));
  const passed = rows.filter(r => r.failures.length === 0).length;
  const usedPct = budgetUsd > 0 ? Math.min(100, (risk.requiredMarginUsd / budgetUsd) * 100) : 0;

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Deterministic rules">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Deterministic rules</h3>
        <span className={`num text-sm ${risk.ok ? "text-long" : "text-short"}`}>
          {passed}/{rows.length}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {rows.map(row => {
          const isOk = row.failures.length === 0;
          return (
            <li key={row.label} className="flex flex-col gap-0.5">
              <span className="flex items-start gap-2 text-sm">
                {isOk ? (
                  <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-long" aria-label="passes" />
                ) : (
                  <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-short" aria-label="fails" />
                )}
                <span className={isOk ? "text-ash" : "text-bone"}>{row.label}</span>
              </span>
              {row.failures.map((f, i) => (
                <span key={i} className="num pl-6 text-[11px] text-short">
                  {f.detail}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="label-caps">Margin used</span>
          <span className="num text-xs text-ash">
            {fmtUsd(risk.requiredMarginUsd)} / {fmtUsd(budgetUsd)} USD
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div
            className={`h-full rounded-full ${risk.ok ? "bg-violet" : "bg-short"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>
      <p
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
          risk.ok ? "border-long/30 bg-long/10 text-long" : "border-short/30 bg-short/10 text-short"
        }`}
      >
        {risk.ok ? (
          <CheckCircleIcon className="h-5 w-5" aria-hidden />
        ) : (
          <XCircleIcon className="h-5 w-5" aria-hidden />
        )}
        {risk.ok ? "Risk approved" : "Plan rejected by the rules"}
      </p>
    </section>
  );
};
