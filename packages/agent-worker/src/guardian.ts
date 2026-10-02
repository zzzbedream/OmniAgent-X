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
import { type DecisionLog, jsonReplacer } from "./log";

export type MandateRecord = {
  owner: Address;
  account: Address;
  mandate: GuardianMandate;
  mandateHash: Hex;
  nonce: string;
  expiresAt: number;
  activatedAt: number;
  state: GuardianState;
  /** UTC day (YYYY-MM-DD) that state.actionsToday counts. */
  stateDay: string;
};

const utcDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** Active mandates by account, persisted as one JSON file written atomically (temp file + rename). */
export class GuardianStore {
  private readonly file: string;
  private records: Record<string, MandateRecord> = {};

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "guardian.json");
    if (existsSync(this.file)) this.records = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, MandateRecord>;
  }

  private persist() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.records, jsonReplacer, 2));
    renameSync(tmp, this.file);
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
    const state = this.stateFor(account, nowSec);
    const next: GuardianState = {
      lastActionAtSec: { ...state.lastActionAtSec, [action.market]: nowSec },
      actionsToday: action.type === "close" ? state.actionsToday : state.actionsToday + 1,
      collateralAddedUsd: state.collateralAddedUsd + (action.type === "addCollateral" ? action.usd : 0),
    };
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

export class GuardianLoop {
  private readonly lastTick = new Map<string, TickStatus>();
  private readonly backoffUntil = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly deps: GuardianDeps) {}

  status(account: string): TickStatus | undefined {
    return this.lastTick.get(account.toLowerCase());
  }

  start(intervalMs: number) {
    if (intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
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
      for (const rec of this.deps.store.active(now)) {
        await this.deps.withLock(rec.account, () => this.guard(rec, now));
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
    const mandate = this.effectiveMandate(rec.mandate);
    if (mandate.rules.length === 0) {
      this.lastTick.set(key, { at: now, actions: [], skipped: [], error: "every rule needs collateral top-ups, which are disabled" });
      return;
    }
    let positions: GuardedPosition[];
    try {
      positions = await this.deps.readPositions(rec);
    } catch (e) {
      this.lastTick.set(key, { at: now, actions: [], skipped: [], error: (e as Error).message.slice(0, 300) });
      return;
    }
    const ready = positions.filter(p => (this.backoffUntil.get(`${key}:${p.market}`) ?? 0) <= now);
    const decision = evaluateGuardian(mandate, ready, this.deps.store.stateFor(key, now), now);
    this.lastTick.set(key, { at: now, ...decision });

    for (const action of decision.actions) {
      const position = ready.find(p => p.market === action.market)!;
      let outcome: ExecutionOutcome;
      try {
        outcome = await this.deps.execute(rec, action, position);
      } catch (e) {
        outcome = { status: "failed", error: (e as Error).message.slice(0, 500) };
      }
      this.logAction(rec, action, outcome, now);
      if (outcome.status === "failed") this.backoffUntil.set(`${key}:${action.market}`, now + FAILURE_BACKOFF_SEC);
      else this.deps.store.recordAction(key, action, now);
    }
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
