/**
 * One outbound call shared by everyone who would otherwise make it.
 *
 * In-memory and therefore per warm instance, like the rate limiters beside it:
 * the CMS holds no shared state, and adding a database would put one on the
 * request path. What it buys is that the several requests one admin navigation
 * fires make a single provider call between them — and, where that call spends
 * something single-use, that they cannot race each other for it.
 */

interface Entry<T> {
  /** When the result stops being worth reusing. */
  expiry: number;
  value: Promise<T>;
}

/** How many tracked keys it takes before expiry is worth scanning for. */
const SWEEP_THRESHOLD = 64;

export class Coalesced<T> {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry<T>>();

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
    // once it has grown, since the sweep is O(entries) and every miss would
    // otherwise pay for it.
    if (this.entries.size > SWEEP_THRESHOLD) {
      for (const [other, entry] of this.entries) {
        if (entry.expiry <= now) this.entries.delete(other);
      }
    }

    const entry: Entry<T> = { expiry: now + this.ttlMs, value: work() };

    this.entries.set(key, entry);

    // A failure must not become what every later caller reads: the entry is
    // dropped so the next one retries rather than inheriting the rejection.
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });

    return entry.value;
  }
}
