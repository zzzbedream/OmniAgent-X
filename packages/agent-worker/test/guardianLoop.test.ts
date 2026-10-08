import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GuardedPosition, type GuardianMandate, type PositionInput, hashMandate, positionMetrics } from "@omniagent/core";
import { describe, expect, it } from "vitest";
import { GuardianLoop, GuardianStore, type MandateRecord } from "../src/guardian";
import { DecisionLog } from "../src/log";

const account = "0x00000000000000000000000000000000000000Aa".toLowerCase() as `0x${string}`;
const owner = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
const DAY = 86_400;
const T0 = 1_800_000_000 - (1_800_000_000 % DAY) + 3600; // 01:00 UTC

const mandate: GuardianMandate = {
  version: 1,
  markets: ["BTC"],
  rules: [
    { trigger: { kind: "liquidationBuffer", belowPct: 15 }, action: { type: "addCollateral", usd: 20 } },
    { trigger: { kind: "liquidationBuffer", belowPct: 8 }, action: { type: "reduce", fraction: 0.5 } },
    { trigger: { kind: "liquidationBuffer", belowPct: 4 }, action: { type: "close" } },
  ],
  cooldownSec: 300,
  maxActionsPerDay: 6,
  collateralBudgetUsd: 20,
};

function position(depositUsd: number): GuardedPosition {
  const input: PositionInput = {
    side: "long",
    lotLNS: 1000n,
    entryPricePNS: 800_000n,
    markPricePNS: 800_000n,
    depositCNS: BigInt(depositUsd * 1e6),
    priceDecimals: 1,
    lotDecimals: 5,
    collateralDecimals: 6,
    maintenanceFraction: 0.04,
  };
  return { market: "BTC", side: "long", lotLNS: input.lotLNS, markPriceValid: true, metrics: positionMetrics(input) };
}

function setup(opts: { addCollateralEnabled?: boolean; execStatus?: "built" | "sent" | "failed"; deposit?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omni-guard-"));
  const store = new GuardianStore(dir);
  const log = new DecisionLog(dir);
  let now = T0;
  let deposit = opts.deposit ?? 90; // 7.25 pts → reduce zone
  const executed: string[] = [];
  store.activate(
    { owner, account, mandate, mandateHash: hashMandate(mandate), nonce: "1", expiresAt: T0 + 7 * DAY, activatedAt: T0 },
    T0,
  );
  const loop = new GuardianLoop({
    store,
    log,
    mode: opts.execStatus === "sent" ? "live" : "dry-run",
    addCollateralEnabled: opts.addCollateralEnabled ?? true,
    readPositions: async () => [position(deposit)],
    execute: async (_rec: MandateRecord, action) => {
      executed.push(action.type);
      return opts.execStatus === "failed" ? { status: "failed", error: "reverted" } : { status: opts.execStatus ?? "built" };
    },
    withLock: (_k, fn) => fn(),
    now: () => now,
  });
  return {
    dir,
    store,
    log,
    loop,
    executed,
    advance: (s: number) => (now += s),
    setDeposit: (d: number) => (deposit = d),
  };
}

describe("GuardianStore", () => {
  it("persists mandates and their state across restarts", () => {
    const { dir } = setup();
    const reloaded = new GuardianStore(dir);
    expect(reloaded.get(account)?.mandateHash).toBe(hashMandate(mandate));
  });

  it("drops expired mandates from the active set", () => {
    const { store } = setup();
    expect(store.active(T0 + 8 * DAY)).toEqual([]);
  });

  it("revokes a mandate", () => {
    const { store } = setup();
    expect(store.revoke(account)).toBe(true);
    expect(store.get(account)).toBeUndefined();
  });

  it("resets the daily action count at UTC midnight", () => {
    const { store } = setup();
    store.recordAction(account, { market: "BTC", type: "reduce", fraction: 0.5, lotLNS: 500n, hit: { trigger: mandate.rules[1]!.trigger, observed: 7 } }, T0);
    expect(store.stateFor(account, T0 + 60).actionsToday).toBe(1);
    expect(store.stateFor(account, T0 + DAY).actionsToday).toBe(0);
  });
});

describe("GuardianStore sides", () => {
  it("remembers a resolved side across restarts and forgets it on request", () => {
    const { dir, store } = setup();
    store.rememberSide(account, "BTC", "short");
    expect(new GuardianStore(dir).sideFor(account, "BTC")).toBe("short");
    store.forgetSide(account, "BTC");
    expect(store.sideFor(account, "BTC")).toBeUndefined();
  });
});

describe("GuardianLoop.tick", () => {
  it("skips an account whose mandate was revoked after the tick started", async () => {
    const { store, log } = setup();
    const executed: string[] = [];
    const loop = new GuardianLoop({
      store,
      log,
      mode: "dry-run",
      addCollateralEnabled: true,
      readPositions: async () => [position(60)],
      execute: async (_r, a) => {
        executed.push(a.type);
        return { status: "built" };
      },
      withLock: async (_k, fn) => {
        store.revoke(account); // the owner's revoke wins the lock first
        return fn();
      },
      now: () => T0,
    });
    await loop.tick();
    expect(executed).toEqual([]);
  });

  it("records the error and keeps the process alive when saving state fails", async () => {
    const { store, loop } = setup({ execStatus: "sent" });
    store.recordAction = () => {
      throw new Error("EPERM rename");
    };
    await expect(loop.tick()).resolves.toBeUndefined();
    expect(loop.status(account)?.error).toMatch(/EPERM/);
  });

  it("logs a dry-run close once per cooldown, not on every tick", async () => {
    const { loop, executed, advance, setDeposit } = setup();
    setDeposit(60);
    await loop.tick();
    advance(5);
    await loop.tick();
    expect(executed).toEqual(["close"]);
    advance(400);
    await loop.tick();
    expect(executed).toEqual(["close", "close"]);
  });

  it("executes the engine's action, logs it with an explanation and starts the cooldown", async () => {
    const { loop, executed, log, store } = setup();
    await loop.tick();
    expect(executed).toEqual(["reduce"]);
    const [entry] = log.recent(account);
    expect(entry).toMatchObject({ kind: "guardian", mode: "dry-run", status: "built", planHash: hashMandate(mandate) });
    expect((entry!.detail as { explanation: string }).explanation).toMatch(/^BTC: reduciría la posición 50%/);
    // Dry-run cooldowns live in memory only, so switching to live starts from a clean state.
    expect(store.stateFor(account, T0).lastActionAtSec.BTC).toBeUndefined();

    await loop.tick(); // still in cooldown: no second action
    expect(executed).toEqual(["reduce"]);
    expect(loop.status(account)?.skipped).toMatchObject([{ reason: "cooldown" }]);
  });

  it("does not top up collateral while top-ups are disabled", async () => {
    const { loop, executed, setDeposit } = setup({ addCollateralEnabled: false });
    setDeposit(120); // 11 pts: only the top-up rule is breached
    await loop.tick();
    expect(executed).toEqual([]);
  });

  it("backs off after a failed transaction instead of retrying every tick", async () => {
    const { loop, executed, log, store, advance, setDeposit } = setup({ execStatus: "failed" });
    setDeposit(60); // close zone: close ignores the cooldown, so only the failure backoff stops a retry
    await loop.tick();
    await loop.tick();
    expect(executed).toEqual(["close"]);
    expect(log.recent(account)[0]).toMatchObject({ status: "failed" });
    expect(store.stateFor(account, T0).actionsToday).toBe(0);
    advance(120);
    await loop.tick();
    expect(executed).toEqual(["close", "close"]);
  });

  it("keeps going when reading one account fails", async () => {
    const { store, log } = setup();
    const loop = new GuardianLoop({
      store,
      log,
      mode: "dry-run",
      addCollateralEnabled: true,
      readPositions: async () => {
        throw new Error("rpc down");
      },
      execute: async () => ({ status: "built" }),
      withLock: (_k, fn) => fn(),
      now: () => T0,
    });
    await loop.tick();
    expect(loop.status(account)?.error).toMatch(/rpc down/);
  });
});
