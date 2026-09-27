import { afterEach, expect, it, vi } from "vitest";
import { relay } from "@/ai/handler";
import type { AiServerConfig } from "@/integration/types";

const ai: AiServerConfig = {
  gateway: { type: "custom", baseUrl: "https://gateway.example.com/v1" },
  maxSteps: 4,
  limits: { maxRequestBytes: 1024, maxOutputTokens: 100 },
};

const fail = (message: string, status: number): Response => new Response(message, { status });

const send = (caller: string, body = '{"model":"allowed"}'): Promise<Response> =>
  relay({
    request: new Request("https://site.example.com/ai/chat/completions", { method: "POST", body }),
    ai,
    models: ["allowed"],
    caller,
    fail,
  });

afterEach(() => vi.unstubAllGlobals());

it("rejects a JSON null body and releases its slot without the body being read", async () => {
  for (let i = 0; i < 5; i++) {
    const response = await send("null-body-test", "null");

    expect(response.status).toBe(400);

    if (i === 0) await expect(response.text()).resolves.toBe("A request object is required.");
  }
});

it("releases a streaming slot when the response body is cancelled", async () => {
  vi.stubGlobal(
    "fetch",
    () => Promise.resolve(new Response(new ReadableStream({ start() {} }))),
  );
  const responses = await Promise.all(Array.from({ length: 4 }, () => send("cancelled-stream-test")));

  await responses[0]?.body?.cancel();

  const next = await send("cancelled-stream-test");

  expect(next.status).toBe(200);
  await Promise.all(responses.slice(1).map(async (response) => response.body?.cancel()));
  await next.body?.cancel();
});

it("preserves streamed bytes and releases the slot after completion", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("answer")));

  for (let i = 0; i < 5; i++) {
    const response = await send("completed-stream-test");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("answer");
  }
});
