// Testnet gas station. Every onboarding step is a transaction the passkey owner must send itself (the Perpl factory
// and DelegatedAccount require msg.sender = owner), so a brand-new passkey address with 0 MON cannot even start.
// The station sends a fixed MON drip and asks the collateral faucet for test AUSD on the owner's behalf.
// Abuse limits: once per address (persisted), a global daily cap, the worker's per-IP rate limit, and the owner's
// signature (checked by the route). It uses its own key, never the operator's.
import { join } from "node:path";
import { type Address, type Hex, getAddress } from "viem";
import { loadJson, writeAtomic } from "./guardian";
import { safeErrorMessage } from "./log";
import { KeyedMutex } from "./rateLimit";
import { ValidationError } from "./validate";

export type GasStationDeps = {
  getMonBalance: (a: Address) => Promise<bigint>;
  getCollateralBalance: (a: Address) => Promise<bigint>;
  /** Sends `wei` MON from the station and resolves once the transfer is confirmed. */
  sendMon: (to: Address, wei: bigint) => Promise<Hex>;
  /** Asks the testnet collateral faucet to fund `to` (the station pays gas); resolves once confirmed. */
  requestCollateral: (to: Address) => Promise<Hex>;
};

export type FundStep =
  | { status: "sent"; txHash: Hex }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type FundResult = {
  status: "funded" | "not-needed" | "already-funded";
  owner: Address;
  mon?: FundStep;
  collateral?: FundStep;
};

type State = {
  funded: Record<string, { at: number; monTx?: Hex; collateralTx?: Hex }>;
  /** Fundings per UTC day (YYYY-MM-DD); only the last few days are kept. */
  perDay: Record<string, number>;
};

const DAYS_KEPT = 7;

export class GasStation {
  private readonly file: string;
  private state: State;
  /** One funding at a time: keeps the daily count exact and the station's nonces in order. */
  private readonly lock = new KeyedMutex();
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      dataDir: string;
      dripWei: bigint;
      minBalanceWei: bigint;
      minCollateral: bigint;
      dailyCap: number;
      deps: GasStationDeps;
      now?: () => number;
    },
  ) {
    this.file = join(opts.dataDir, "gas-station.json");
    this.state = loadJson<State>(this.file, { funded: {}, perDay: {} });
    this.now = opts.now ?? Date.now;
  }

  fund(owner: Address): Promise<FundResult> {
    const key = getAddress(owner);
    return this.lock.run("station", () => this.fundLocked(key));
  }

  private async fundLocked(owner: Address): Promise<FundResult> {
    if (this.state.funded[owner]) return { status: "already-funded", owner };
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if ((this.state.perDay[day] ?? 0) >= this.opts.dailyCap) {
      throw new ValidationError("the test-funds station reached its daily limit; try again tomorrow");
    }

    const { deps } = this.opts;
    const [mon, collateral] = await Promise.all([deps.getMonBalance(owner), deps.getCollateralBalance(owner)]);

    // A failed gas drip throws and records nothing, so the user can retry.
    const monStep: FundStep =
      mon < this.opts.minBalanceWei
        ? { status: "sent", txHash: await deps.sendMon(owner, this.opts.dripWei) }
        : { status: "skipped", reason: "already has gas" };

    // With gas in hand the user can still press the faucet button, so a faucet failure is reported, not fatal.
    let collateralStep: FundStep;
    if (collateral >= this.opts.minCollateral) {
      collateralStep = { status: "skipped", reason: "already has collateral" };
    } else {
      try {
        collateralStep = { status: "sent", txHash: await deps.requestCollateral(owner) };
      } catch (e) {
        collateralStep = { status: "failed", error: safeErrorMessage(e, 200) };
      }
    }

    if (monStep.status !== "sent" && collateralStep.status !== "sent") {
      return { status: "not-needed", owner, mon: monStep, collateral: collateralStep };
    }
    this.record(owner, day, monStep, collateralStep);
    return { status: "funded", owner, mon: monStep, collateral: collateralStep };
  }

  private record(owner: Address, day: string, mon: FundStep, collateral: FundStep) {
    const perDay = Object.fromEntries(
      Object.entries({ ...this.state.perDay, [day]: (this.state.perDay[day] ?? 0) + 1 })
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, DAYS_KEPT),
    );
    this.state = {
      funded: {
        ...this.state.funded,
        [owner]: {
          at: this.now(),
          monTx: mon.status === "sent" ? mon.txHash : undefined,
          collateralTx: collateral.status === "sent" ? collateral.txHash : undefined,
        },
      },
      perDay,
    };
    writeAtomic(this.file, this.state);
  }
}
