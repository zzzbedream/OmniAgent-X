import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { GasStation, type GasStationDeps } from "../src/gasStation";
import { ValidationError } from "../src/validate";

const ALICE = "0x000000000000000000000000000000000000A11c" as Address;
const BOB = "0x0000000000000000000000000000000000000B0B" as Address;
const DRIP = 500_000_000_000_000_000n; // 0.5 MON
const MIN_BALANCE = 100_000_000_000_000_000n; // 0.1 MON
const MIN_COLLATERAL = 100_000_000n; // 100 AUSD (6 decimals)

// Addresses are compared lowercase: the station checksums what it receives.
const lc = (a: Address) => a.toLowerCase() as Address;

function fakeChain(over: Partial<Record<Address, { mon?: bigint; ausd?: bigint }>> = {}) {
  const balances = new Map(Object.entries(over).map(([a, b]) => [a.toLowerCase(), b]));
  const sent: { kind: "mon" | "ausd"; to: Address }[] = [];
  let failMon = false;
  const deps: GasStationDeps = {
    getMonBalance: async a => balances.get(a.toLowerCase())?.mon ?? 0n,
    getCollateralBalance: async a => balances.get(a.toLowerCase())?.ausd ?? 0n,
    sendMon: async (to, wei) => {
      if (failMon) throw new Error("insufficient funds in gas station");
      expect(wei).toBe(DRIP);
      sent.push({ kind: "mon", to: lc(to) });
      return `0x${"aa".repeat(32)}` as Hex;
    },
    requestCollateral: async to => {
      sent.push({ kind: "ausd", to: lc(to) });
      return `0x${"bb".repeat(32)}` as Hex;
    },
  };
  return { deps, sent, failNextMon: () => (failMon = true) };
}

const station = (deps: GasStationDeps, dir = mkdtempSync(join(tmpdir(), "omni-gas-")), now = () => Date.UTC(2026, 9, 9, 12)) =>
  new GasStation({ dataDir: dir, dripWei: DRIP, minBalanceWei: MIN_BALANCE, minCollateral: MIN_COLLATERAL, dailyCap: 2, deps, now });

describe("GasStation", () => {
  it("gives a brand-new passkey address gas and test collateral", async () => {
    const chain = fakeChain();
    const r = await station(chain.deps).fund(ALICE);
    expect(r.status).toBe("funded");
    expect(r.mon).toMatchObject({ status: "sent" });
    expect(r.collateral).toMatchObject({ status: "sent" });
    expect(chain.sent).toEqual([
      { kind: "mon", to: lc(ALICE) },
      { kind: "ausd", to: lc(ALICE) },
    ]);
  });

  it("only sends what is missing", async () => {
    const chain = fakeChain({ [ALICE]: { mon: MIN_BALANCE, ausd: 0n }, [BOB]: { mon: 0n, ausd: MIN_COLLATERAL } });
    const s = station(chain.deps);
    expect((await s.fund(ALICE)).mon).toMatchObject({ status: "skipped" });
    expect((await s.fund(BOB)).collateral).toMatchObject({ status: "skipped" });
    expect(chain.sent).toEqual([
      { kind: "ausd", to: lc(ALICE) },
      { kind: "mon", to: lc(BOB) },
    ]);
  });

  it("sends nothing and records nothing when the address already has both", async () => {
    const chain = fakeChain({ [ALICE]: { mon: DRIP, ausd: MIN_COLLATERAL } });
    const s = station(chain.deps);
    expect((await s.fund(ALICE)).status).toBe("not-needed");
    expect(chain.sent).toEqual([]);
  });

  it("funds an address once, even across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-gas-"));
    const chain = fakeChain();
    await station(chain.deps, dir).fund(ALICE);
    const again = await station(chain.deps, dir).fund(ALICE.toLowerCase() as Address);
    expect(again.status).toBe("already-funded");
    expect(chain.sent).toHaveLength(2);
  });

  it("serialises concurrent requests for one address", async () => {
    const chain = fakeChain();
    const s = station(chain.deps);
    const [a, b] = await Promise.all([s.fund(ALICE), s.fund(ALICE)]);
    expect([a.status, b.status].sort()).toEqual(["already-funded", "funded"]);
    expect(chain.sent).toHaveLength(2);
  });

  it("stops at the daily cap and starts again the next UTC day", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-gas-"));
    let now = Date.UTC(2026, 9, 9, 12);
    const chain = fakeChain();
    const s = station(chain.deps, dir, () => now);
    await s.fund(ALICE);
    await s.fund(BOB);
    const carol = "0x0000000000000000000000000000000000000Ca1" as Address;
    await expect(s.fund(carol)).rejects.toBeInstanceOf(ValidationError);
    now = Date.UTC(2026, 9, 10, 0, 1);
    expect((await s.fund(carol)).status).toBe("funded");
  });

  it("does not record a failed drip, so the user can retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-gas-"));
    const chain = fakeChain();
    chain.failNextMon();
    await expect(station(chain.deps, dir).fund(ALICE)).rejects.toThrow(/insufficient funds/);
    const retry = station(fakeChain().deps, dir);
    expect((await retry.fund(ALICE)).status).toBe("funded");
  });

  it("keeps the gas when only the collateral faucet fails, and reports it", async () => {
    const chain = fakeChain();
    chain.deps.requestCollateral = async () => {
      throw new Error("faucet cooldown");
    };
    const r = await station(chain.deps).fund(ALICE);
    expect(r.status).toBe("funded");
    expect(r.mon).toMatchObject({ status: "sent" });
    expect(r.collateral).toMatchObject({ status: "failed", error: expect.stringMatching(/cooldown/) });
  });
});
