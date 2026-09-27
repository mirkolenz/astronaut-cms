import { afterEach, expect, it, vi } from "vitest";
import { relay } from "@/ai/handler";
import type { AiServerConfig } from "@/integration/types";

const ai: AiServerConfig = {
  gateway: { type: "custom", baseUrl: "https://gateway.example.com/v1" },
  maxSteps: 4,
  limits: { maxRequestBytes: 1024, maxOutputTokens: 100 },
};

const fail = (message: string, status: number): Response => new Response(message, { status });

const request = (body: string): Request =>
  new Request("https://site.example.com/ai/chat/completions", { method: "POST", body });

afterEach(() => vi.unstubAllGlobals());

it("rejects a JSON null body before reading its model", async () => {
  const response = await relay({
    request: request("null"),
    ai,
    models: ["allowed"],
    caller: "null-body-test",
    fail,
  });

  expect(response.status).toBe(400);
  await expect(response.text()).resolves.toBe("A request object is required.");
});

it("releases rejected requests without waiting for the client to read their bodies", async () => {
  const options = {
    ai,
    models: ["allowed"],
    caller: "rejected-request-test",
    fail,
  };

  for (let i = 0; i < 5; i++) {
    const response = await relay({ ...options, request: request("null") });

    expect(response.status).toBe(400);
  }
});

it("releases a streaming slot when the response body is cancelled", async () => {
  vi.stubGlobal(
    "fetch",
    () => Promise.resolve(new Response(new ReadableStream({ start() {} }))),
  );
  const options = {
    ai,
    models: ["allowed"],
    caller: "cancelled-stream-test",
    fail,
  };
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      relay({ ...options, request: request('{"model":"allowed"}') }),
    ),
  );

  await responses[0]?.body?.cancel();

  const next = await relay({ ...options, request: request('{"model":"allowed"}') });

  expect(next.status).toBe(200);
  await Promise.all(responses.slice(1).map(async (response) => response.body?.cancel()));
  await next.body?.cancel();
});

it("preserves streamed bytes and releases the slot after completion", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("answer")));

  for (let i = 0; i < 5; i++) {
    const response = await relay({
      request: request('{"model":"allowed"}'),
      ai,
      models: ["allowed"],
      caller: "completed-stream-test",
      fail,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("answer");
  }
});
