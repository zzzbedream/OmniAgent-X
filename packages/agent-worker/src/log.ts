// Append-only JSONL decision log. It is the audit trail (what was asked, validated, sent) and the
// source of used approval nonces after a restart.
import { sideFromDecisionLog } from "@omniagent/core";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DecisionEntry = {
  ts: string;
  /** guardian = an action the guardian took; mandate/revoke = owner-signed activation and revocation. */
  kind: "plan" | "close" | "guardian" | "mandate" | "revoke";
  owner: string;
  account: string;
  nonce: string;
  /** Plan hash, or the mandate hash for guardian entries. */
  planHash: string;
  mode: "dry-run" | "live";
  status: "pending" | "rejected" | "built" | "sent" | "partial" | "failed" | "active" | "revoked";
  detail?: unknown;
};

export const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/**
 * Error text that is safe to log and serve: URLs are removed (viem errors embed the RPC URL, which can
 * carry a provider API key) and the length is bounded.
 */
export function safeErrorMessage(e: unknown, max = 300): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "<url>").slice(0, max);
}

export class DecisionLog {
  private readonly file: string;
  private readonly usedNonces = new Set<string>();
  /** Parsed copy of the file, so readers (the guardian, every tick) never re-read it from disk. */
  private entries: DecisionEntry[] = [];

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "decisions.jsonl");
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as DecisionEntry;
        this.entries.push(e);
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

  /**
   * Atomically claims an approval nonce before any on-chain work: returns false if it was already used or
   * reserved. The reservation is persisted as a `pending` entry, so a crash after a tx is sent but before
   * the result is logged still consumes the nonce on restart (no replay).
   */
  reserve(entry: Omit<DecisionEntry, "status" | "detail">): boolean {
    const key = DecisionLog.key(entry.owner, entry.nonce);
    if (this.usedNonces.has(key)) return false;
    this.usedNonces.add(key);
    const pending = { ...entry, status: "pending" as const };
    appendFileSync(this.file, JSON.stringify(pending, jsonReplacer) + "\n");
    this.entries.push(JSON.parse(JSON.stringify(pending, jsonReplacer)) as DecisionEntry);
    return true;
  }

  append(entry: DecisionEntry) {
    if (entry.status !== "rejected") this.usedNonces.add(DecisionLog.key(entry.owner, entry.nonce));
    const line = JSON.stringify(entry, jsonReplacer);
    appendFileSync(this.file, line + "\n");
    // Store what a restart would read back (bigints as strings), so readers see one shape.
    this.entries.push(JSON.parse(line) as DecisionEntry);
  }

  /**
   * Side of the latest position this worker opened for (account, perpId), from the order type it sent
   * (the verified on-chain OrderDescEnum). Live mode only trusts orders that produced a tx hash; dry-run
   * mode reads dry-run entries so the close flow can be exercised without a chain.
   */
  sideForMarket(account: string, perpId: bigint, mode: "dry-run" | "live"): "long" | "short" | undefined {
    return sideFromDecisionLog(this.all().reverse(), account, perpId, mode);
  }

  private all(): DecisionEntry[] {
    return [...this.entries];
  }

  recent(account?: string, limit = 50): DecisionEntry[] {
    return this.all()
      .filter(e => !account || e.account.toLowerCase() === account.toLowerCase())
      .slice(-limit)
      .reverse();
  }
}
