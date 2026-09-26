// Append-only JSONL decision log. It is the audit trail (what was asked, validated, sent) and the
// source of used approval nonces after a restart.
import { sideOfOpenOrderType } from "@omniagent/core";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DecisionEntry = {
  ts: string;
  kind: "plan" | "close";
  owner: string;
  account: string;
  nonce: string;
  planHash: string;
  mode: "dry-run" | "live";
  status: "rejected" | "built" | "sent" | "partial" | "failed";
  detail?: unknown;
};

export const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export class DecisionLog {
  private readonly file: string;
  private readonly usedNonces = new Set<string>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "decisions.jsonl");
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as DecisionEntry;
        if (e.status !== "rejected") this.usedNonces.add(DecisionLog.key(e.owner, e.nonce));
      }
    }
  }

  static key(owner: string, nonce: string | bigint) {
    return `${owner.toLowerCase()}:${nonce.toString()}`;
  }

  isNonceUsed(owner: string, nonce: bigint) {
    return this.usedNonces.has(DecisionLog.key(owner, nonce));
  }

  append(entry: DecisionEntry) {
    if (entry.status !== "rejected") this.usedNonces.add(DecisionLog.key(entry.owner, entry.nonce));
    appendFileSync(this.file, JSON.stringify(entry, jsonReplacer) + "\n");
  }

  /**
   * Side of the latest position this worker opened for (account, perpId), from the order type it sent
   * (the verified on-chain OrderDescEnum). Live mode only trusts orders that produced a tx hash; dry-run
   * mode reads dry-run entries so the close flow can be exercised without a chain.
   */
  sideForMarket(account: string, perpId: bigint, mode: "dry-run" | "live"): "long" | "short" | undefined {
    for (const e of this.all().reverse()) {
      if (e.account.toLowerCase() !== account.toLowerCase() || e.mode !== mode) continue;
      if (e.kind === "close" && e.status === "sent" && (e.detail as { perpId?: string })?.perpId === perpId.toString()) {
        return undefined; // closed after the last open
      }
      if (e.kind !== "plan" || !Array.isArray(e.detail)) continue;
      for (const o of e.detail as { order?: { perpId?: string; orderType?: number }; txHash?: string }[]) {
        if (o.order?.perpId !== perpId.toString()) continue;
        if (mode === "live" && !o.txHash) continue;
        const side = sideOfOpenOrderType(Number(o.order.orderType));
        if (side) return side;
      }
    }
    return undefined;
  }

  private all(): DecisionEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l) as DecisionEntry);
  }

  recent(account?: string, limit = 50): DecisionEntry[] {
    return this.all()
      .filter(e => !account || e.account.toLowerCase() === account.toLowerCase())
      .slice(-limit)
      .reverse();
  }
}
