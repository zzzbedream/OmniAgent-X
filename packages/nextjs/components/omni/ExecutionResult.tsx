import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { EXPLORER_TX, describeOrderType, marketOfPerpId, shortHex } from "~~/components/omni/format";

type Simulation = { ok: true; orderId: string } | { ok: false; error: string };
type WireOrder = { perpId?: string; orderType?: number; pricePNS?: string; lotLNS?: string };
type ExecutedOrder = { order?: WireOrder; txHash?: string; error?: string; simulation?: Simulation };
type Execution = { mode?: string; status?: string; orders?: ExecutedOrder[]; error?: string };

const STATUS_LABEL: Record<string, string> = {
  built: "Order built",
  sent: "Sent to Perpl",
  partial: "Partly sent",
  failed: "Failed",
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
    <span className="text-sm text-ash">{label}</span>
    <span className="num text-right text-sm text-bone">{children}</span>
  </div>
);

/** The worker's answer, readable: mode, status, on-chain simulation or tx, never raw JSON first. */
export const ExecutionResult = ({ execution }: { execution: Record<string, unknown> }) => {
  const ex = execution as Execution;
  const isLive = ex.mode === "live";
  const status = ex.status ?? "";
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Agent result">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Agent result</h3>
        <div className="flex gap-2">
          <span className={isLive ? "chip-live" : "chip-sim"}>{isLive ? "Live" : "Simulation"}</span>
          <span className={status === "failed" ? "chip-short" : "chip-muted"}>{STATUS_LABEL[status] ?? status}</span>
        </div>
      </header>

      {(ex.orders ?? []).map((o, i) => {
        const kind = o.order?.orderType !== undefined ? describeOrderType(Number(o.order.orderType)) : undefined;
        const market = o.order?.perpId ? marketOfPerpId(o.order.perpId) : undefined;
        return (
          <div key={i} className="rounded-md border border-line bg-raised px-3">
            <Row label="Order">
              {kind?.label ?? "—"} {market ?? ""}
            </Row>
            {o.simulation && (
              <Row label="On-chain simulation">
                {o.simulation.ok ? (
                  <span className="text-long">OK · orderId {o.simulation.orderId}</span>
                ) : (
                  <span className="text-short">Reverts</span>
                )}
              </Row>
            )}
            {o.simulation && !o.simulation.ok && (
              <p className="num pb-2 text-[11px] break-all text-short">{o.simulation.error}</p>
            )}
            {o.txHash && (
              <Row label="Transaction">
                <a
                  className="link inline-flex items-center gap-1"
                  href={`${EXPLORER_TX}${o.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortHex(o.txHash, 10, 6)}
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Row>
            )}
            {o.error && <p className="num pb-2 text-[11px] break-all text-short">{o.error}</p>}
          </div>
        );
      })}

      {!isLive && (
        <p className="text-xs text-smoke">
          Simulation mode: the agent validated and simulated the order but sent nothing to the network.
        </p>
      )}

      <details className="text-xs text-smoke">
        <summary className="cursor-pointer select-none">Technical details</summary>
        <pre className="num mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-void p-3 text-[11px] text-ash">
          {JSON.stringify(execution, null, 2)}
        </pre>
      </details>
    </section>
  );
};
