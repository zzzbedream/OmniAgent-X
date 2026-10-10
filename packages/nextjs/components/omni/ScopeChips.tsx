import { DEFAULT_TESTNET_POLICY } from "@omniagent/core";
import { LockClosedIcon } from "@heroicons/react/24/outline";

/** What the agent may and may not touch, straight from the deterministic policy the worker enforces. */
export const ScopeChips = ({ budgetUsd }: { budgetUsd?: number }) => (
  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
    <span className="chip-muted">Can · trade {DEFAULT_TESTNET_POLICY.allowedMarkets.join(" ")}</span>
    <span className="chip-muted">Max {DEFAULT_TESTNET_POLICY.maxLeverage}x</span>
    {budgetUsd !== undefined && budgetUsd > 0 && <span className="chip-muted">Budget {budgetUsd} USD</span>}
    <span className="chip border-short/40 bg-short/10 text-short">
      <LockClosedIcon className="h-3 w-3" aria-hidden />
      Cannot · withdraw funds
    </span>
  </div>
);
