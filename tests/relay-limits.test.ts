import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBody } from "@shared/http";
import { RateLimiter } from "@shared/rate-limit";
import { isActiveContentType, mediaContentType } from "@shared/media";

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
});

describe("stored content types", () => {
  it("derives the type from the extension and flags the ones a browser runs", () => {
    expect(mediaContentType("photos/hero.PNG")).toBe("image/png");
    expect(mediaContentType("notes.unknown")).toBe("application/octet-stream");
    expect(isActiveContentType(mediaContentType("logo.svg"))).toBe(true);
    expect(isActiveContentType(mediaContentType("logo.png"))).toBe(false);
  });
});
