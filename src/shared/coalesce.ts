/**
 * One outbound call shared by everyone who would otherwise make it.
 *
 * In-memory and therefore per warm instance, like the rate limiters beside it:
 * the CMS holds no shared state, and adding a database would put one on the
 * request path. What it buys is that the several requests one admin navigation
 * fires make a single provider call between them, and, where that call spends
 * something single-use, that they cannot race each other for it.
 *
 * A TTL of zero joins callers to a call already on its way and keeps nothing
 * after it settles, which is what a caller wants when the answer's own lifetime
 * is recorded somewhere else. Anything larger also answers from the result for
 * that long.
 */

interface Entry<T> {
  /** When the result stops being worth reusing. */
  expiry: number;
  value: Promise<T>;
}

/** How many tracked keys it takes before expiry is worth scanning for. */
const SWEEP_THRESHOLD = 64;

/** And how rarely, so a burst of misses does not each pay for the scan. */
const SWEEP_INTERVAL_MS = 10_000;

export class Coalesced<T> {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry<T>>();
  private lastSweep = 0;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * The result for `key`, computing it only when nothing recent enough is
   * already on its way. The *promise* is kept rather than its value, so a caller
   * arriving mid-flight joins the call in progress instead of starting a second.
   */
  run(key: string, work: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key);

    if (cached && cached.expiry > now) return cached.value;

    // Expired entries are dropped here, so the map stays bounded by what is
    // currently in use rather than by everything the instance has served. Only
    // once it has grown and only now and then, since the scan is O(entries).
    if (this.entries.size > SWEEP_THRESHOLD && now - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.lastSweep = now;

      for (const [other, entry] of this.entries) {
        if (entry.expiry <= now) this.entries.delete(other);
      }
    }

    // Held for the window, or, with none, for as long as the call is on its
    // way, which is what `forget` below then ends.
    const entry: Entry<T> = {
      expiry: this.ttlMs > 0 ? now + this.ttlMs : Infinity,
      value: Promise.try(work),
    };

    this.entries.set(key, entry);

    const forget = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };

    // A failure must not become what every later caller reads, and without a
    // window neither must a success: the next caller asks again rather than
    // inheriting either.
    entry.value.then(() => {
      if (this.ttlMs <= 0) forget();
    }, forget);

    return entry.value;
  }
}
