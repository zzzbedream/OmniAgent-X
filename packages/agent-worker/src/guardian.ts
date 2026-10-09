// Guardian runtime: stores owner-signed mandates and, every tick, asks the pure engine what to do for
// each protected account, then executes it through the operator. I/O is injected (positions reader,
// executor, lock, clock) so the loop is unit-testable without a chain.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GuardedPosition,
  type GuardianAction,
  type GuardianMandate,
  type GuardianSkip,
  type GuardianState,
  EMPTY_GUARDIAN_STATE,
  PERPL_TESTNET,
  describeGuardianAction,
  evaluateGuardian,
} from "@omniagent/core";
import type { Address, Hex } from "viem";
import { type DecisionLog, jsonReplacer, safeErrorMessage } from "./log";

export type MandateRecord = {
  owner: Address;
  account: Address;
  mandate: GuardianMandate;
  mandateHash: Hex;
  nonce: string;
  expiresAt: number;
  activatedAt: number;
  /** Execution mode the owner signed under; a dry-run mandate must be re-activated to run live. */
  mode?: "dry-run" | "live";
  state: GuardianState;
  /** UTC day (YYYY-MM-DD) that state.actionsToday counts. */
  stateDay: string;
};

const utcDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** State after one action, with the daily counter reset when the UTC day changed. Pure. */
function advanceState(state: GuardianState, stateDay: string, action: GuardianAction, nowSec: number): GuardianState {
  const today = stateDay === utcDay(nowSec) ? state : { ...state, actionsToday: 0 };
  return {
    lastActionAtSec: { ...today.lastActionAtSec, [action.market]: nowSec },
    actionsToday: action.type === "close" ? today.actionsToday : today.actionsToday + 1,
    collateralAddedUsd: today.collateralAddedUsd + (action.type === "addCollateral" ? action.usd : 0),
  };
}

type Side = "long" | "short";

/** Reads a JSON file; a corrupt one is moved aside (not deleted) so the worker can still start. */
export function loadJson<T>(file: string, empty: T): T {
  if (!existsSync(file)) return empty;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    const aside = `${file}.corrupt-${Date.now()}`;
    renameSync(file, aside);
    console.error(`${file} was unreadable (${(e as Error).message}); moved to ${aside}`);
    return empty;
  }
}

/** Writes JSON through a temp file + rename, so a crash never leaves a half-written file. */
export function writeAtomic(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, jsonReplacer, 2));
  renameSync(tmp, file);
}

/** Active mandates by account, persisted as one JSON file written atomically (temp file + rename). */
export class GuardianStore {
  private readonly file: string;
  private readonly sidesFile: string;
  private records: Record<string, MandateRecord>;
  /** Side of each open position once resolved, by "account:market". Survives a close that did not fill. */
  private sides: Record<string, Side>;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "guardian.json");
    this.sidesFile = join(dataDir, "guardian-sides.json");
    this.records = loadJson<Record<string, MandateRecord>>(this.file, {});
    this.sides = loadJson<Record<string, Side>>(this.sidesFile, {});
  }

  private persist() {
    writeAtomic(this.file, this.records);
  }

  sideFor(account: string, market: string): Side | undefined {
    return this.sides[`${account.toLowerCase()}:${market}`];
  }

  rememberSide(account: string, market: string, side: Side) {
    const key = `${account.toLowerCase()}:${market}`;
    if (this.sides[key] === side) return;
    this.sides = { ...this.sides, [key]: side };
    writeAtomic(this.sidesFile, this.sides);
  }

  /** Called when the position is observed absent on-chain, so a later position is not given a stale side. */
  forgetSide(account: string, market: string) {
    const key = `${account.toLowerCase()}:${market}`;
    if (!(key in this.sides)) return;
    const { [key]: _gone, ...rest } = this.sides;
    this.sides = rest;
    writeAtomic(this.sidesFile, this.sides);
  }

  /** A new mandate replaces the previous one for the account and starts from a clean state. */
  activate(rec: Omit<MandateRecord, "state" | "stateDay">, nowSec: number): MandateRecord {
    const full: MandateRecord = { ...rec, state: EMPTY_GUARDIAN_STATE, stateDay: utcDay(nowSec) };
    this.records = { ...this.records, [rec.account.toLowerCase()]: full };
    this.persist();
    return full;
  }

  revoke(account: string): boolean {
    const key = account.toLowerCase();
    if (!this.records[key]) return false;
    const { [key]: _removed, ...rest } = this.records;
    this.records = rest;
    this.persist();
    return true;
  }

  get(account: string): MandateRecord | undefined {
    return this.records[account.toLowerCase()];
  }

  active(nowSec: number): MandateRecord[] {
    return Object.values(this.records).filter(r => r.expiresAt > nowSec);
  }

  /** The record's state with the daily counter reset when the UTC day changed. */
  stateFor(account: string, nowSec: number): GuardianState {
    const rec = this.get(account);
    if (!rec) return EMPTY_GUARDIAN_STATE;
    return rec.stateDay === utcDay(nowSec) ? rec.state : { ...rec.state, actionsToday: 0 };
  }

  recordAction(account: string, action: GuardianAction, nowSec: number) {
    const rec = this.get(account);
    if (!rec) return;
    const next = advanceState(rec.state, rec.stateDay, action, nowSec);
    this.records = { ...this.records, [account.toLowerCase()]: { ...rec, state: next, stateDay: utcDay(nowSec) } };
    this.persist();
  }
}

export type ExecutionOutcome = { status: "built" | "sent" | "failed"; txHash?: Hex; error?: string };

export type GuardianDeps = {
  store: GuardianStore;
  log: DecisionLog;
  mode: "dry-run" | "live";
  /** Top-ups stay off until increasePositionCollateral is proven on testnet (spike S2-bis). */
  addCollateralEnabled: boolean;
  readPositions: (rec: MandateRecord) => Promise<GuardedPosition[]>;
  execute: (rec: MandateRecord, action: GuardianAction, position: GuardedPosition) => Promise<ExecutionOutcome>;
  withLock: <T>(account: string, fn: () => Promise<T>) => Promise<T>;
  /** Unix seconds. */
  now: () => number;
};

export type TickStatus = { at: number; actions: GuardianAction[]; skipped: GuardianSkip[]; error?: string };

/** After a failed transaction, wait before trying that market again (also covers closes, which skip the cooldown). */
export const FAILURE_BACKOFF_SEC = 60;
/**
 * After a sent close, wait before closing that market again. An IOC close can land without filling, and closes
 * skip the cooldown, so without this a stuck position would get a close every tick (security review H2).
 */
export const CLOSE_RETRY_SEC = 60;

export class GuardianLoop {
  private readonly lastTick = new Map<string, TickStatus>();
  private readonly backoffUntil = new Map<string, number>();
  /** Dry-run cooldowns and counters: in memory only, so a later live run starts from a clean state. */
  private readonly dryRunState = new Map<string, { state: GuardianState; day: string }>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly deps: GuardianDeps) {}

  status(account: string): TickStatus | undefined {
    return this.lastTick.get(account.toLowerCase());
  }

  start(intervalMs: number) {
    if (intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(e => console.error("guardian tick failed", e));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over every active mandate. Overlapping ticks are skipped rather than queued. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.deps.now();
      for (const snapshot of this.deps.store.active(now)) {
        try {
          await this.deps.withLock(snapshot.account, async () => {
            // Re-read under the lock: a revoke or replacement may have won the lock since the snapshot.
            const rec = this.deps.store.get(snapshot.account);
            if (!rec || rec.mandateHash !== snapshot.mandateHash || rec.expiresAt <= now) return;
            await this.guard(rec, now);
          });
        } catch (e) {
          // One account's failure (disk, log) must not stop the others or crash the process.
          const key = snapshot.account.toLowerCase();
          const prev = this.lastTick.get(key);
          this.lastTick.set(key, {
            at: now,
            actions: prev?.actions ?? [],
            skipped: prev?.skipped ?? [],
            error: safeErrorMessage(e),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private effectiveMandate(m: GuardianMandate): GuardianMandate {
    return this.deps.addCollateralEnabled ? m : { ...m, rules: m.rules.filter(r => r.action.type !== "addCollateral") };
  }

  private async guard(rec: MandateRecord, now: number) {
    const key = rec.account.toLowerCase();
    if (rec.mode !== undefined && rec.mode !== this.deps.mode) {
      this.lastTick.set(key, {
        at: now,
        actions: [],
        skipped: [],
        error: `mandate was signed in ${rec.mode} mode; re-activate it to run in ${this.deps.mode} mode`,
      });
      return;
    }
    const mandate = this.effectiveMandate(rec.mandate);
    if (mandate.rules.length === 0) {
      this.lastTick.set(key, { at: now, actions: [], skipped: [], error: "every rule needs collateral top-ups, which are disabled" });
      return;
    }
    let positions: GuardedPosition[];
    try {
      positions = await this.deps.readPositions(rec);
    } catch (e) {
      this.lastTick.set(key, { at: now, actions: [], skipped: [], error: safeErrorMessage(e) });
      return;
    }
    const ready = positions.filter(p => (this.backoffUntil.get(`${key}:${p.market}`) ?? 0) <= now);
    const state = this.stateFor(key, now);
    const decision = evaluateGuardian(mandate, ready, state, now);
    this.lastTick.set(key, { at: now, ...decision });

    for (const action of decision.actions) {
      const position = ready.find(p => p.market === action.market)!;
      // Closes skip the cooldown. In dry-run nothing closes, so log a would-be close once per cooldown.
      const last = state.lastActionAtSec[action.market];
      if (this.deps.mode === "dry-run" && last !== undefined && now - last < rec.mandate.cooldownSec) continue;
      let outcome: ExecutionOutcome;
      try {
        outcome = await this.deps.execute(rec, action, position);
      } catch (e) {
        outcome = { status: "failed", error: safeErrorMessage(e, 500) };
      }
      this.logAction(rec, action, outcome, now);
      if (outcome.status === "failed") this.backoffUntil.set(`${key}:${action.market}`, now + FAILURE_BACKOFF_SEC);
      else {
        this.record(key, action, now);
        if (action.type === "close") this.backoffUntil.set(`${key}:${action.market}`, now + CLOSE_RETRY_SEC);
      }
    }
  }

  private stateFor(key: string, now: number): GuardianState {
    if (this.deps.mode === "live") return this.deps.store.stateFor(key, now);
    const dry = this.dryRunState.get(key);
    if (!dry) return EMPTY_GUARDIAN_STATE;
    return dry.day === utcDay(now) ? dry.state : { ...dry.state, actionsToday: 0 };
  }

  private record(key: string, action: GuardianAction, now: number) {
    if (this.deps.mode === "live") return this.deps.store.recordAction(key, action, now);
    const dry = this.dryRunState.get(key) ?? { state: EMPTY_GUARDIAN_STATE, day: utcDay(now) };
    this.dryRunState.set(key, { state: advanceState(dry.state, dry.day, action, now), day: utcDay(now) });
  }

  private logAction(rec: MandateRecord, action: GuardianAction, outcome: ExecutionOutcome, now: number) {
    const dryRun = this.deps.mode === "dry-run";
    this.deps.log.append({
      ts: new Date(now * 1000).toISOString(),
      kind: "guardian",
      owner: rec.owner,
      account: rec.account,
      nonce: `guardian:${rec.nonce}:${now}:${action.market}`,
      planHash: rec.mandateHash,
      mode: this.deps.mode,
      status: outcome.status,
      detail: {
        ...action,
        perpId: PERPL_TESTNET.markets[action.market].toString(),
        explanation: describeGuardianAction(action, { dryRun: dryRun || outcome.status !== "sent" }),
        txHash: outcome.txHash,
        error: outcome.error,
      },
    });
  }
}
