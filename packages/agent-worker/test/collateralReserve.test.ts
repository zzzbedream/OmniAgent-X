import { describe, expect, it, vi } from "vitest";
import { CollateralReserve, type ReserveDeps } from "../src/collateralReserve";

const USER = "0x00000000000000000000000000000000000000aa" as const;
const GRANT = 200n;
const DRIP = 10_000n;

function fakeChain(opts: { balance: bigint; nextDripAt?: number; failDrips?: number }) {
  let balance = opts.balance;
  let now = 1_000;
  let failDrips = opts.failDrips ?? 0;
  const deps: ReserveDeps = {
    balance: vi.fn(async () => balance),
    transfer: vi.fn(async (_to, amount) => {
      if (amount > balance) throw new Error("ERC20: transfer amount exceeds balance");
      balance -= amount;
      return "0xt" as `0x${string}`;
    }),
    drip: vi.fn(async () => {
      if (failDrips > 0) {
        failDrips--;
        throw new Error('reverted with signature 0x20e5bc67 "MaxFrequencyExceeded()"');
      }
      balance += DRIP;
      return "0xd" as `0x${string}`;
    }),
    nextDripAt: vi.fn(async () => opts.nextDripAt ?? 0),
    nowSec: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += Math.ceil(ms / 1000);
    }),
  };
  return { deps, balance: () => balance };
}

const reserve = (deps: ReserveDeps) =>
  new CollateralReserve({ grant: GRANT, lowWater: 2_000n, maxWaitSec: 75, attempts: 3, deps });

describe("CollateralReserve", () => {
  it("pays a new user straight from the reserve without touching the faucet", async () => {
    // Arrange
    const chain = fakeChain({ balance: 5_000n });
    // Act
    const hash = await reserve(chain.deps).send(USER);
    // Assert
    expect(hash).toBe("0xt");
    expect(chain.deps.transfer).toHaveBeenCalledWith(USER, GRANT);
    expect(chain.deps.drip).not.toHaveBeenCalled();
  });

  it("refills from the faucet first when the reserve cannot cover the grant", async () => {
    const chain = fakeChain({ balance: 50n });
    await reserve(chain.deps).send(USER);
    expect(chain.deps.drip).toHaveBeenCalledTimes(1);
    expect(chain.balance()).toBe(50n + DRIP - GRANT);
  });

  it("waits for the faucet's global window instead of reverting inside it", async () => {
    const chain = fakeChain({ balance: 0n, nextDripAt: 1_040 });
    await reserve(chain.deps).send(USER);
    expect(chain.deps.sleep).toHaveBeenCalledWith(41_000);
    expect(chain.deps.drip).toHaveBeenCalledTimes(1);
  });

  it("retries when another project takes the faucet window first", async () => {
    const chain = fakeChain({ balance: 0n, failDrips: 2 });
    await reserve(chain.deps).send(USER);
    expect(chain.deps.drip).toHaveBeenCalledTimes(3);
    expect(chain.deps.transfer).toHaveBeenCalledWith(USER, GRANT);
  });

  it("fails with a readable message when the faucet stays busy", async () => {
    const chain = fakeChain({ balance: 0n, failDrips: 5 });
    await expect(reserve(chain.deps).send(USER)).rejects.toThrow(/faucet is busy/);
    expect(chain.deps.transfer).not.toHaveBeenCalled();
  });

  it("does not wait longer than allowed for the window", async () => {
    const chain = fakeChain({ balance: 0n, nextDripAt: 1_500 });
    await expect(reserve(chain.deps).send(USER)).rejects.toThrow(/faucet is busy/);
    expect(chain.deps.drip).not.toHaveBeenCalled();
  });

  it("tops up in the background only below the low-water mark", async () => {
    const full = fakeChain({ balance: 5_000n });
    await reserve(full.deps).topUp();
    expect(full.deps.drip).not.toHaveBeenCalled();

    const low = fakeChain({ balance: 1_000n });
    await reserve(low.deps).topUp();
    expect(low.deps.drip).toHaveBeenCalledTimes(1);
  });

  it("runs one refill at a time so concurrent users share a single drip", async () => {
    const chain = fakeChain({ balance: 0n });
    const r = reserve(chain.deps);
    await Promise.all([r.send(USER), r.send(USER)]);
    expect(chain.deps.drip).toHaveBeenCalledTimes(1);
    expect(chain.deps.transfer).toHaveBeenCalledTimes(2);
  });
});
