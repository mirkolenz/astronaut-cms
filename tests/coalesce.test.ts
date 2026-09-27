import { describe, expect, it } from "vitest";
import { Coalesced } from "@/shared/coalesce";

// Both providers rotate the refresh token, so a second concurrent exchange of
// the same one does not just waste a call, it invalidates the first. This is the
// thing that stops that happening.

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("coalesced calls", () => {
  it("runs one call for everyone who asks while it is in flight", async () => {
    const shared = new Coalesced<string>(60_000);
    const { promise, resolve } = deferred<string>();
    let calls = 0;

    const work = () => {
      calls++;

      return promise;
    };

    const waiting = [shared.run("k", work), shared.run("k", work), shared.run("k", work)];

    resolve("once");

    await expect(Promise.all(waiting)).resolves.toEqual(["once", "once", "once"]);
    expect(calls).toBe(1);
  });

  it("keeps the result only as long as it is worth reusing", async () => {
    const expired = new Coalesced<number>(-1);
    let calls = 0;
    const work = () => Promise.resolve(++calls);

    await expired.run("k", work);
    await expired.run("k", work);

    expect(calls).toBe(2);
  });

  it("keeps callers apart by key", async () => {
    const shared = new Coalesced<string>(60_000);

    await expect(shared.run("a", () => Promise.resolve("a"))).resolves.toBe("a");
    await expect(shared.run("b", () => Promise.resolve("b"))).resolves.toBe("b");
  });

  // A failure must not become what every later caller reads for the whole TTL.
  it("does not keep a failure", async () => {
    const shared = new Coalesced<string>(60_000);

    await expect(shared.run("k", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(shared.run("k", () => Promise.resolve("up"))).resolves.toBe("up");
  });
});
