import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/shared/rate-limit";

// Calls made in the same tick travel as one request, which is what turns a
// navigation's five queries into one function invocation. These pin the two
// things that has to get right: everyone in the batch gets their own answer, and
// batching is not a way around the per-editor budget.

const requests: Array<{ body: unknown; headers: Headers }> = [];

function stubFetch(reply: (ops: Array<{ op: string }>) => { status?: number; body: unknown }) {
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Array<{ op: string }>;

    requests.push({ body, headers: new Headers(init?.headers) });

    const { status = 200, body: payload } = reply(body);

    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("window", { location: { origin: "https://x.test", reload: () => {} } });
  vi.stubGlobal("document", { getElementById: () => null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("batched calls", () => {
  it("sends one request and answers each caller from its own result", async () => {
    stubFetch((ops) => ({ body: ops.map((_, index) => ({ ok: true, data: index })) }));

    const { call } = await import("@/client/lib/api");
    const answers = await Promise.all([
      call("getStatus", {}),
      call("getChanges", {}),
      call("listMedia", {}),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual([
      { op: "getStatus", input: {} },
      { op: "getChanges", input: {} },
      { op: "listMedia", input: {} },
    ]);
    expect(answers).toEqual([0, 1, 2]);
    // Nothing in this batch changes anything, so the dev server is not told to
    // treat it as a write.
    expect(requests[0]?.headers.has("x-astronaut-cms-write")).toBe(false);
  });

  it("fails only the operation that failed, and marks a batch carrying a write", async () => {
    stubFetch(() => ({
      body: [
        { ok: false, error: { status: 409, message: "Merge conflict" } },
        { ok: true, data: { ok: true } },
      ],
    }));

    const { call, isMergeConflict } = await import("@/client/lib/api");
    const [failed, succeeded] = await Promise.allSettled([
      call("publish", {}),
      call("discard", {}),
    ]);

    expect(failed.status).toBe("rejected");
    expect(isMergeConflict((failed as PromiseRejectedResult).reason)).toBe(true);
    expect(succeeded.status).toBe("fulfilled");
    expect(requests[0]?.headers.get("x-astronaut-cms-write")).toBe("1");
  });
});

// A batch occupies one slot but must not count as one operation, or batching
// would be a way around the budget rather than a way to spend fewer invocations.
describe("budget charged per operation", () => {
  it("counts a batch by what it carries", () => {
    const limiter = new RateLimiter({ requests: 10, windowMs: 60_000, concurrency: 4 });

    expect(limiter.acquire("alice", 6).ok).toBe(true);
    expect(limiter.acquire("alice", 6).ok).toBe(false);
    expect(limiter.acquire("alice", 4).ok).toBe(true);
  });
});
