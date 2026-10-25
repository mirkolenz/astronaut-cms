import { describe, expect, it, vi } from "vitest";
import { BodyTooLargeError, readBody, readBytes } from "@/shared/http";
import { RateLimiter, callerAddress, limited } from "@/shared/rate-limit";

// The injected routes spend something the caller does not own — a gateway
// credential, a bucket — on a request the caller shapes. These are the three
// places that refuse to take the caller's word for it.

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/", { method: "POST", body, headers });
}

describe("readBody", () => {
  it("returns a body within the limit", async () => {
    await expect(readBody(post("hello"), 1024)).resolves.toBe("hello");
  });

  it("refuses an oversized body, declared or not", async () => {
    await expect(readBody(post("x".repeat(100)), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    // A lying content-length is caught by the measured stream rather than the header.
    await expect(
      readBody(post("x".repeat(100), { "content-length": "5" }), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  // An upload arrives as bytes and may declare no length at all, so the ceiling
  // has to hold while the stream is read rather than after it is all in memory.
  it("measures an undeclared binary body as it arrives", async () => {
    const undeclared = new Request("https://example.com/", {
      method: "PUT",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(8));
          controller.enqueue(new Uint8Array(8));
          controller.close();
        },
      }),
      // @ts-expect-error undici requires this for a streaming body, the types do not list it.
      duplex: "half",
    });

    await expect(readBytes(undeclared, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

describe("RateLimiter", () => {
  const config = { requests: 2, windowMs: 60_000, concurrency: 1 };

  it("bounds requests per window and requests in flight, per caller", () => {
    const limiter = new RateLimiter(config);
    const first = limiter.acquire("alice");

    expect(first.ok).toBe(true);
    // Alice is busy; Bob is not.
    expect(limiter.acquire("alice")).toMatchObject({ ok: false, reason: "concurrency" });
    expect(limiter.acquire("bob").ok).toBe(true);

    if (first.ok) first.release();

    const second = limiter.acquire("alice");

    expect(second.ok).toBe(true);

    if (second.ok) second.release();

    // Two started in this window is all alice gets, idle or not.
    expect(limiter.acquire("alice")).toMatchObject({ ok: false, reason: "rate" });
  });

  it("releases a request that outlives its rate window", () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const limiter = new RateLimiter(config);

    try {
      const first = limiter.acquire("alice");

      expect(first.ok).toBe(true);

      now = config.windowMs + 1;
      expect(limiter.acquire("alice")).toMatchObject({ ok: false, reason: "concurrency" });

      if (first.ok) first.release();

      now += config.windowMs + 1;
      expect(limiter.acquire("alice").ok).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("limited", () => {
  const budget = () => new RateLimiter({ requests: 2, windowMs: 60_000, concurrency: 1 });
  const denied = () => new Error("too many");

  it("releases the slot however the work ends", async () => {
    const limiter = budget();

    await limited(limiter, "alice", denied, () => Promise.resolve("ok"));
    await limited(limiter, "alice", denied, () => Promise.reject(new Error("boom"))).catch(
      () => undefined,
    );

    // Two requests spent, but neither left a slot held.
    await expect(limited(limiter, "alice", denied, () => Promise.resolve("x"))).rejects.toThrow(
      "too many",
    );
    await expect(limited(limiter, "bob", denied, () => Promise.resolve("x"))).resolves.toBe("x");
  });

  // The expensive operations are capped by concurrency rather than by rate: one
  // reference scan at a time per editor, whatever the interface asks for.
  it("serializes work when concurrency is one", async () => {
    const limiter = budget();
    let release = () => {};
    const first = limited(limiter, "alice", denied, () => new Promise<void>((r) => (release = r)));

    await expect(
      limited(limiter, "alice", denied, () => Promise.resolve("second")),
    ).rejects.toThrow("too many");

    release();
    await first;
  });
});

// The platform sets one of these in front of a serverless function; reached
// directly they are the caller's to spell, which is why a shared bucket backs them.
describe("callerAddress", () => {
  const from = (headers: Record<string, string>) =>
    callerAddress(new Request("https://x.test/", { headers }));

  it("prefers the platform header and takes the first forwarded hop", () => {
    expect(from({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })).toBe("1.1.1.1");
    expect(from({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })).toBe("2.2.2.2");
    expect(from({})).toBe("anonymous");
  });
});
