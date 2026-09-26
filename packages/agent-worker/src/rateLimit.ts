// In-memory token bucket per client key. Per process only: enough to blunt abuse of a single worker,
// not a distributed limiter.
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    if (this.perMinute <= 0) return true;
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, updated: t };
    b.tokens = Math.min(this.perMinute, b.tokens + ((t - b.updated) / 60_000) * this.perMinute);
    b.updated = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear(); // bound memory under a flood of distinct keys
    return ok;
  }
}

/** Serialises async work per key (one execution at a time per account). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
