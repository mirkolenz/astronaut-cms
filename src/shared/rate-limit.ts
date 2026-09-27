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

interface Caller {
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
  private readonly callers = new Map<string, Caller>();

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Claims a slot for `caller`, or names why it could not. A granted slot must
   * be released with the returned callback once the request is done, whether it
   * succeeded or not.
   *
   * `cost` is what the request spends of the per-window budget, for a request
   * that carries more than one thing to do: a batch of operations occupies one
   * slot but must not count as one operation, or batching would be a way around
   * the budget rather than a way to spend fewer invocations on it.
   */
  acquire(
    caller: string,
    cost = 1,
  ): { ok: true; release: () => void } | { ok: false; reason: RateLimitDenial } {
    const now = Date.now();
    const state = this.caller(caller, now);

    if (state.inFlight >= this.config.concurrency) return { ok: false, reason: "concurrency" };
    if (state.count + cost > this.config.requests) return { ok: false, reason: "rate" };

    state.count += cost;
    state.inFlight++;

    let released = false;

    return {
      ok: true,
      release: () => {
        if (released) return;

        released = true;
        state.inFlight--;
      },
    };
  }

  // Expired windows are dropped here, so the map stays bounded by the callers
  // currently active rather than by everyone the instance has served. Only once
  // the map has grown, since the sweep is O(callers) and every request would
  // otherwise pay for it.
  private caller(caller: string, now: number): Caller {
    if (this.callers.size > SWEEP_THRESHOLD) {
      for (const [key, value] of this.callers) {
        if (value.until <= now && value.inFlight === 0) this.callers.delete(key);
      }
    }

    const existing = this.callers.get(caller);

    // Rolled over in place rather than replaced, so a request still in flight
    // from the previous window keeps being counted against the concurrency cap.
    if (existing) {
      if (existing.until <= now) {
        existing.until = now + this.config.windowMs;
        existing.count = 0;
      }

      return existing;
    }

    const fresh: Caller = { until: now + this.config.windowMs, count: 0, inFlight: 0 };

    this.callers.set(caller, fresh);

    return fresh;
  }
}

/**
 * Runs `work` in a slot, releasing it however the work ends. For a streaming
 * response the slot has to outlive the handler, so the AI relay holds its own
 * (see `ai/handler.ts`); everything else is a request that finishes.
 */
export async function limited<T>(
  limiter: RateLimiter,
  caller: string,
  denied: () => Error,
  work: () => Promise<T>,
  cost = 1,
): Promise<T> {
  const slot = limiter.acquire(caller, cost);

  if (!slot.ok) throw denied();

  try {
    return await work();
  } finally {
    slot.release();
  }
}

/**
 * Who to charge a request to when there is no session yet.
 *
 * The platform sets one of these in front of a serverless function, and behind
 * one they are trustworthy. Reached directly they are the caller's to spell and
 * to rotate, which buys a fresh budget per request — so a bucket keyed on this
 * has to sit inside one charged to everybody at once (see the sign-in limiters
 * in `server/handler.ts`), and the real ceiling still belongs at the CDN. This
 * separates honest callers, it does not identify dishonest ones.
 */
export function callerAddress(request: Request): string {
  for (const header of ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"]) {
    const value = request.headers.get(header);

    if (value) return value.split(",")[0].trim();
  }

  return "anonymous";
}
