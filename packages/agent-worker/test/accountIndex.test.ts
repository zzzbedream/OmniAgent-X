import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { AccountIndex, type CreatedAccount } from "../src/accountIndex";

const ALICE = "0x00000000000000000000000000000000000a11ce" as Address;
const BOB = "0x0000000000000000000000000000000000000b0b" as Address;
const P1 = "0x0000000000000000000000000000000000000001" as Address;
const P2 = "0x0000000000000000000000000000000000000002" as Address;
const P3 = "0x0000000000000000000000000000000000000003" as Address;

/** A fake chain: events at given blocks, and a log of every [from, to] window asked for. */
function fakeChain(events: (CreatedAccount & { block: bigint })[], head: bigint, failOnce = new Set<bigint>()) {
  const windows: [bigint, bigint][] = [];
  return {
    windows,
    deps: {
      getHead: async () => head,
      getCreated: async (from: bigint, to: bigint) => {
        windows.push([from, to]);
        if (failOnce.delete(from)) throw new Error("429 too many requests");
        return events.filter(e => e.block >= from && e.block <= to).map(({ proxy, owner }) => ({ proxy, owner }));
      },
    },
  };
}

const dir = () => mkdtempSync(join(tmpdir(), "omni-accidx-"));

describe("AccountIndex", () => {
  it("scans from the start block to head in windows of at most 100 blocks", async () => {
    const chain = fakeChain([], 1_249n);
    const idx = new AccountIndex({ dataDir: dir(), fromBlock: 1_000n, deps: chain.deps, concurrency: 3 });
    await idx.syncOnce();
    expect(chain.windows.every(([f, t]) => t - f + 1n <= 100n)).toBe(true);
    expect(chain.windows.map(w => w[0]).sort((a, b) => Number(a - b))).toEqual([1_000n, 1_100n, 1_200n]);
    expect(idx.status()).toMatchObject({ cursor: 1_249n, synced: true });
  });

  it("returns an owner's accounts, newest first, whatever the address case", async () => {
    const chain = fakeChain(
      [
        { proxy: P1, owner: ALICE, block: 1_010n },
        { proxy: P2, owner: BOB, block: 1_050n },
        { proxy: P3, owner: ALICE, block: 1_120n },
      ],
      1_200n,
    );
    const idx = new AccountIndex({ dataDir: dir(), fromBlock: 1_000n, deps: chain.deps });
    await idx.syncOnce();
    expect(idx.accountsOf(ALICE.toUpperCase().replace("0X", "0x") as Address)).toEqual([P3, P1]);
    expect(idx.accountsOf(BOB)).toEqual([P2]);
    expect(idx.accountsOf("0x000000000000000000000000000000000000dead")).toEqual([]);
  });

  it("persists the cursor and accounts, and resumes after a restart without rescanning", async () => {
    const d = dir();
    const first = fakeChain([{ proxy: P1, owner: ALICE, block: 1_010n }], 1_099n);
    await new AccountIndex({ dataDir: d, fromBlock: 1_000n, deps: first.deps }).syncOnce();

    const second = fakeChain([{ proxy: P2, owner: ALICE, block: 1_150n }], 1_199n);
    const idx = new AccountIndex({ dataDir: d, fromBlock: 1_000n, deps: second.deps });
    await idx.syncOnce();
    expect(second.windows).toEqual([[1_100n, 1_199n]]);
    expect(idx.accountsOf(ALICE)).toEqual([P2, P1]);
  });

  it("retries a failed window and never skips past it", async () => {
    const chain = fakeChain([{ proxy: P2, owner: BOB, block: 1_150n }], 1_299n, new Set([1_100n]));
    const idx = new AccountIndex({ dataDir: dir(), fromBlock: 1_000n, deps: chain.deps, retryDelayMs: 0 });
    await idx.syncOnce();
    expect(idx.accountsOf(BOB)).toEqual([P2]);
    expect(idx.status().cursor).toBe(1_299n);
  });

  it("stops at the last contiguous window when one keeps failing", async () => {
    const failing = new Set([1_100n]);
    const chain = fakeChain([], 1_299n);
    const deps = {
      ...chain.deps,
      getCreated: async (from: bigint, to: bigint) => {
        if (failing.has(from)) throw new Error("rpc down");
        return chain.deps.getCreated(from, to);
      },
    };
    const idx = new AccountIndex({ dataDir: dir(), fromBlock: 1_000n, deps, retryDelayMs: 0, maxRetries: 2 });
    await idx.syncOnce();
    expect(idx.status()).toMatchObject({ cursor: 1_099n, synced: false });
  });

  it("does not list the same account twice when a window is scanned again", async () => {
    const chain = fakeChain([{ proxy: P1, owner: ALICE, block: 1_010n }], 1_099n);
    const d = dir();
    const idx = new AccountIndex({ dataDir: d, fromBlock: 1_000n, deps: chain.deps });
    await idx.syncOnce();
    // Simulate a crash after the accounts were stored but before the cursor moved.
    const again = new AccountIndex({ dataDir: d, fromBlock: 1_000n, deps: chain.deps });
    (again as unknown as { state: { cursor: string } }).state.cursor = "999";
    await again.syncOnce();
    expect(again.accountsOf(ALICE)).toEqual([P1]);
  });
});
