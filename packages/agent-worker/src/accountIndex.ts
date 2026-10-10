// Owner → DelegatedAccount index, built from the Perpl factory's DelegatedAccountCreated events for THIS worker's
// operator. The factory has no owner → account view, and the PWA only remembers the account in the browser that
// created it, so a user on another browser (or after clearing site data) would be offered a second account.
// The public Monad RPC caps eth_getLogs at 100 blocks, so the index scans forward in 100-block windows from a
// configured start block, persists its cursor, and never moves the cursor past a window it could not read.
import { join } from "node:path";
import { type Address, getAddress } from "viem";
import { loadJson, writeAtomic } from "./guardian";

export type CreatedAccount = { proxy: Address; owner: Address };

export type AccountIndexDeps = {
  getHead: () => Promise<bigint>;
  /** DelegatedAccountCreated events for this operator in [from, to] (inclusive), in log order. */
  getCreated: (from: bigint, to: bigint) => Promise<CreatedAccount[]>;
};

/** eth_getLogs range limit of the public Monad testnet RPC (checked 2026-10-10). */
export const LOGS_WINDOW = 100n;

type State = {
  /** Last block whose window was fully read (decimal string). */
  cursor: string;
  /** Lowercase owner → proxies in creation order. */
  byOwner: Record<string, Address[]>;
};

export class AccountIndex {
  private readonly file: string;
  private state: State;
  private lastHead?: bigint;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly concurrency: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly opts: {
      dataDir: string;
      fromBlock: bigint;
      deps: AccountIndexDeps;
      concurrency?: number;
      retryDelayMs?: number;
      maxRetries?: number;
    },
  ) {
    this.file = join(opts.dataDir, "account-index.json");
    this.state = loadJson<State>(this.file, { cursor: (opts.fromBlock - 1n).toString(), byOwner: {} });
    this.concurrency = opts.concurrency ?? 4;
    this.retryDelayMs = opts.retryDelayMs ?? 1_000;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  /** The owner's accounts, newest first. */
  accountsOf(owner: Address): Address[] {
    return [...(this.state.byOwner[owner.toLowerCase()] ?? [])].reverse();
  }

  status() {
    const cursor = BigInt(this.state.cursor);
    return { cursor, head: this.lastHead, synced: this.lastHead !== undefined && cursor >= this.lastHead };
  }

  /** Reads every window between the cursor and the current head. Stops at the first window that keeps failing. */
  async syncOnce(): Promise<void> {
    const head = await this.opts.deps.getHead();
    this.lastHead = head;
    let next = BigInt(this.state.cursor) + 1n;
    while (next <= head) {
      const windows: [bigint, bigint][] = [];
      for (let i = 0; i < this.concurrency && next <= head; i++) {
        const to = next + LOGS_WINDOW - 1n > head ? head : next + LOGS_WINDOW - 1n;
        windows.push([next, to]);
        next = to + 1n;
      }
      const results = await Promise.all(windows.map(([from, to]) => this.read(from, to)));
      // Commit in order; a failed window stops the cursor there, even if later windows succeeded.
      for (let i = 0; i < windows.length; i++) {
        const found = results[i];
        if (found === undefined) {
          this.persist();
          return;
        }
        for (const a of found) this.add(a);
        this.state.cursor = windows[i]![1].toString();
      }
      this.persist();
    }
  }

  /** Keeps the index following the chain head. */
  start(intervalMs: number) {
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (e) {
        console.error(`account index: ${(e as Error).message}`);
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    void tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async read(from: bigint, to: bigint): Promise<CreatedAccount[] | undefined> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.opts.deps.getCreated(from, to);
      } catch {
        if (attempt < this.maxRetries) await new Promise(r => setTimeout(r, this.retryDelayMs * (attempt + 1)));
      }
    }
    return undefined;
  }

  private add({ proxy, owner }: CreatedAccount) {
    const key = owner.toLowerCase();
    const list = this.state.byOwner[key] ?? [];
    const p = getAddress(proxy);
    if (!list.includes(p)) this.state.byOwner[key] = [...list, p];
  }

  private persist() {
    writeAtomic(this.file, this.state);
  }
}
