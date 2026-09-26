// Append-only JSONL decision log. It is the audit trail (what was asked, validated, sent) and the
// source of used approval nonces after a restart.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DecisionEntry = {
  ts: string;
  kind: "plan";
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

  recent(account?: string, limit = 50): DecisionEntry[] {
    if (!existsSync(this.file)) return [];
    const all = readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l) as DecisionEntry);
    return all.filter(e => !account || e.account.toLowerCase() === account.toLowerCase()).slice(-limit).reverse();
  }
}
