import { describe, expect, it } from "vitest";
import { KeyedMutex, RateLimiter } from "../src/rateLimit";

describe("RateLimiter", () => {
  it("allows N per minute per key and refills over time", () => {
    let t = 0;
    const rl = new RateLimiter(3, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, true, false]);
    expect(rl.take("b")).toBe(true); // independent key
    t += 20_000; // a third of a minute → one token back
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(false);
  });
  it("is disabled with a non-positive limit", () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(rl.take("x")).toBe(true);
  });
});

describe("KeyedMutex", () => {
  it("serialises work for the same key and survives failures", async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const slow = m.run("acc", async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push("first");
      throw new Error("boom");
    });
    const fast = m.run("acc", async () => {
      order.push("second");
      return 2;
    });
    const other = m.run("other", async () => {
      order.push("other");
    });
    await expect(slow).rejects.toThrow("boom");
    await expect(fast).resolves.toBe(2);
    await other;
    expect(order.indexOf("first")).toBeLessThan(order.indexOf("second"));
    expect(order.indexOf("other")).toBeLessThan(order.indexOf("first"));
  });
});
