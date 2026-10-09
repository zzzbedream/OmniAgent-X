import type { TradePlan } from "@omniagent/core";
import { fmtUsd } from "~~/components/omni/format";

type PlanOrder = TradePlan["orders"][number];

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="label-caps">{label}</span>
    <span className="num text-sm text-bone">{value}</span>
  </div>
);

/**
 * One proposed order as a trade ticket: side, market and sizing above a perforated tear line,
 * and whatever belongs to it (reasoning, notes) below.
 */
export const OrderTicket = ({
  order,
  index,
  children,
}: {
  order: PlanOrder;
  index: number;
  children?: React.ReactNode;
}) => {
  const isLong = order.side === "long";
  return (
    <article className="relative overflow-hidden rounded-[var(--radius-box)] border border-line-strong bg-raised">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <span className="num text-[11px] text-smoke">
            TICKET {String(index + 1).padStart(2, "0")} · {order.market}-PERP · IOC
          </span>
          <span className={isLong ? "chip-long" : "chip-short"}>{isLong ? "Largo" : "Corto"}</span>
        </div>
        <p className={`num text-3xl font-semibold tracking-tight ${isLong ? "text-long" : "text-short"}`}>
          {isLong ? "LARGO" : "CORTO"} <span className="text-bone">{order.market}</span>
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Nocional" value={`${fmtUsd(order.notionalUsd)} USD`} />
          <Field label="Apalanc." value={`${order.leverage}x`} />
          <Field label="Margen" value={`${fmtUsd(order.notionalUsd / order.leverage)} USD`} />
        </div>
      </div>
      {children && (
        <>
          {/* Perforation: notches on both edges joined by a dashed tear line. */}
          <div className="relative h-0" aria-hidden>
            <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border border-line-strong bg-void" />
            <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full border border-line-strong bg-void" />
            <span className="absolute left-4 right-4 top-0 border-t border-dashed border-line-strong" />
          </div>
          <div className="p-4 pt-5">{children}</div>
        </>
      )}
    </article>
  );
};
