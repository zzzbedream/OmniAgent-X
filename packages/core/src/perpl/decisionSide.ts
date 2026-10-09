// Side of a position as recorded by the worker that opened it. The on-chain PositionEnum is undocumented, so the
// side is never inferred from it; this reads the verified OrderDescEnum of the open order the worker sent.
import { sideOfOpenOrderType } from "./orders";

/** The fields of a worker decision-log entry (agent-worker/src/log.ts) this lookup needs. */
export type SideLogEntry = { kind: string; account: string; mode: string; status: string; detail?: unknown };

type LoggedOrder = { order?: { perpId?: string; orderType?: number }; txHash?: string };

/**
 * @param newestFirst decision-log entries, newest first (the order GET /decisions returns).
 * @returns the side of the newest open on `perpId` for `account`, or undefined if none or a close came after it.
 *   In live mode only orders that carry a txHash count; dry-run builds never describe a real position.
 */
export function sideFromDecisionLog(
  newestFirst: readonly SideLogEntry[],
  account: string,
  perpId: bigint,
  mode: "dry-run" | "live",
): "long" | "short" | undefined {
  const id = perpId.toString();
  for (const e of newestFirst) {
    if (e.account.toLowerCase() !== account.toLowerCase() || e.mode !== mode) continue;
    if (e.kind === "close" && e.status === "sent" && (e.detail as { perpId?: string } | undefined)?.perpId === id) {
      return undefined; // closed after the last open
    }
    if (e.kind !== "plan" || !Array.isArray(e.detail)) continue;
    for (const o of e.detail as LoggedOrder[]) {
      if (o.order?.perpId !== id) continue;
      if (mode === "live" && !o.txHash) continue;
      const side = sideOfOpenOrderType(Number(o.order.orderType));
      if (side) return side;
    }
  }
  return undefined;
}
