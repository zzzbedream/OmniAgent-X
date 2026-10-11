// Test-collateral reserve for the gas station. Agora's testnet faucet allows one drip every 60 s for the whole
// network, so asking it on a user's behalf fails whenever any other project used it in the last minute. The station
// instead holds a reserve (filled from the faucet in the background) and pays each new user with a plain transfer.
import type { Address, Hex } from "viem";
import { KeyedMutex } from "./rateLimit";

export type ReserveDeps = {
  /** The station's own collateral balance. */
  balance: () => Promise<bigint>;
  /** Transfers collateral from the station and resolves once confirmed. */
  transfer: (to: Address, amount: bigint) => Promise<Hex>;
  /** Asks the faucet to drip to the station and resolves once confirmed. */
  drip: () => Promise<Hex>;
  /** Unix seconds at which the faucet's global window reopens. */
  nextDripAt: () => Promise<number>;
  nowSec: () => number;
  sleep: (ms: number) => Promise<void>;
};

export class CollateralReserve {
  /** Refills are serialized: concurrent users wait for one drip instead of racing each other into the window. */
  private readonly lock = new KeyedMutex();

  constructor(
    private readonly opts: {
      /** Collateral sent to each new user. */
      grant: bigint;
      /** Below this the reserve refills in the background. */
      lowWater: bigint;
      /** Longest wait for the faucet window before giving up on one attempt. */
      maxWaitSec: number;
      attempts: number;
      deps: ReserveDeps;
    },
  ) {}

  async send(to: Address): Promise<Hex> {
    await this.lock.run("refill", async () => {
      if ((await this.opts.deps.balance()) < this.opts.grant) await this.refillLocked();
    });
    return this.opts.deps.transfer(to, this.opts.grant);
  }

  /** Refills when the reserve is low. Safe to call without awaiting; failures only mean the next send refills. */
  topUp(): Promise<void> {
    return this.lock.run("refill", async () => {
      if ((await this.opts.deps.balance()) < this.opts.lowWater) await this.refillLocked();
    });
  }

  private async refillLocked(): Promise<void> {
    const { deps } = this.opts;
    let lastError: unknown;
    for (let i = 0; i < this.opts.attempts; i++) {
      const wait = (await deps.nextDripAt()) - deps.nowSec();
      if (wait > this.opts.maxWaitSec) break;
      // One extra second: the faucet compares against the block timestamp, which can lag the wall clock.
      if (wait > 0) await deps.sleep((wait + 1) * 1000);
      try {
        await deps.drip();
        return;
      } catch (e) {
        // Another project took the window between our read and our drip: wait for the next one.
        lastError = e;
      }
    }
    throw new Error(
      `the testnet AUSD faucet is busy (one drip per minute for all of Monad testnet); try again shortly${
        lastError ? ` (${(lastError as Error).message.split("\n")[0].slice(0, 120)})` : ""
      }`,
    );
  }
}
