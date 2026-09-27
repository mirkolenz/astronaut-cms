/**
 * Per-caller request and concurrency ceilings for a relay that spends a shared
 * credential.
 *
 * Deliberately in-memory and therefore per warm instance, not per deployment:
 * an injected route holds no shared state, and adding one would mean a database
 * on the request path. What this stops is a runaway agent loop or a single
 * stolen token quietly draining a gateway budget; the hard ceiling belongs at
 * the gateway, where the budget actually lives.
 */

interface Window {
  /** When the current counting window ends. */
  until: number;
  count: number;
  inFlight: number;
}

export interface RateLimitConfig {
  /** Requests one caller may start per window. */
  requests: number;
  windowMs: number;
  /** Requests one caller may have running at once. */
  concurrency: number;
}

/** Why a request was refused, as the text the caller is shown. */
export type RateLimitDenial = "rate" | "concurrency";

/** How many tracked callers it takes before expiry is worth scanning for. */
const SWEEP_THRESHOLD = 64;

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly callers = new Map<string, Window>();

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Claims a slot for `caller`, or names why it could not. A granted slot must
   * be released with the returned callback once the request is done, whether it
   * succeeded or not.
   */
  acquire(caller: string): { ok: true; release: () => void } | { ok: false; reason: RateLimitDenial } {
    const now = Date.now();
    const window = this.window(caller, now);

    if (window.inFlight >= this.config.concurrency) return { ok: false, reason: "concurrency" };
    if (window.count >= this.config.requests) return { ok: false, reason: "rate" };

    window.count++;
    window.inFlight++;

    let released = false;

    return {
      ok: true,
      release: () => {
        if (released) return;

        released = true;
        window.inFlight--;
      },
    };
  }

  // Expired windows are dropped here, so the map stays bounded by the callers
  // currently active rather than by everyone the instance has served. Only once
  // the map has grown, since the sweep is O(callers) and every request would
  // otherwise pay for it.
  private window(caller: string, now: number): Window {
    if (this.callers.size > SWEEP_THRESHOLD) {
      for (const [key, value] of this.callers) {
        if (value.until <= now && value.inFlight === 0) this.callers.delete(key);
      }
    }

    const existing = this.callers.get(caller);

    if (existing && existing.until > now) return existing;

    const fresh: Window = {
      until: now + this.config.windowMs,
      count: 0,
      inFlight: existing?.inFlight ?? 0,
    };

    this.callers.set(caller, fresh);

    return fresh;
  }
}
