/**
 * A stateless streaming proxy between the browser-side agent loop and the
 * configured AI gateway. It holds no secret of its own and answers only to a
 * request the CMS server has already authenticated.
 *
 * The agent loop stays in the browser deliberately. Every request through here
 * is one model call, so nothing depends on how long a whole turn takes and no
 * serverless duration limit can cut a conversation in half; the tools the model
 * calls go through the same operation registry as the UI, so they are bounded by
 * the same rules rather than by where they run.
 */
import type { AiServerConfig } from "@/integration/types";
import { gatewayAddress, NETLIFY_GATEWAY_ENV, type AiGateway } from "@/shared/ai";
import { BodyTooLargeError, readBody } from "@/shared/http";
import { RateLimiter } from "@/shared/rate-limit";
import { getSecret } from "astro:env/server";
import { joinUrl } from "@/shared/url";
import { errorMessage } from "@/shared/errors";
import { z } from "zod";

const requestBodySchema = z.record(z.string(), z.unknown());

/** The `Authorization` header for a gateway credential, or none when it has none. */
const bearer = (token: string | undefined): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

/**
 * Assistant turns one editor may start per minute, which is how the request
 * ceiling is expressed. A turn is up to `maxSteps` relay requests, so a rate
 * configured beside `maxSteps` could contradict it: raise `maxSteps` past the
 * per-minute budget and a single turn throttles itself halfway through. Deriving
 * the one from the other removes both the knob and the contradiction.
 */
const TURNS_PER_MINUTE = 4;

/** Requests one editor may have in flight at once. Streaming, so each is held for a while. */
const CONCURRENCY = 4;

// One limiter per warm instance. The config is a build-time constant, so it
// cannot change under a running instance and the limiter is simply built once.
let limiter: RateLimiter | null = null;

function rateLimiter({ maxSteps }: AiServerConfig): RateLimiter {
  limiter ??= new RateLimiter({
    requests: maxSteps * TURNS_PER_MINUTE,
    windowMs: 60_000,
    concurrency: CONCURRENCY,
  });

  return limiter;
}

/**
 * The request as it is forwarded: the caller's own body with an output ceiling
 * imposed on it. A completion the caller sizes is a bill the caller sizes, so
 * the limit is applied whether or not one was asked for.
 */
function bounded(body: Record<string, unknown>, maxOutputTokens: number): Record<string, unknown> {
  const field = "max_completion_tokens" in body ? "max_completion_tokens" : "max_tokens";
  const asked = body[field];

  return {
    ...body,
    [field]: typeof asked === "number" ? Math.min(asked, maxOutputTokens) : maxOutputTokens,
  };
}

interface Gateway {
  url: string;
  headers: Record<string, string>;
}

// The gateway comes from static config and its credential from the server's
// environment alone, most of it injected by the platform, so nothing reaches
// the browser.
function resolveGateway(gateway: AiGateway, request: Request): Gateway {
  const address = gatewayAddress(gateway);

  if (!address) {
    // Requiring the pair means a key is only ever sent to the endpoint it was
    // issued with: Netlify injects both or, once a site sets either, neither.
    const [base, key] = NETLIFY_GATEWAY_ENV.map((name) => getSecret(name));

    if (!base || !key) {
      throw new Error(
        `Netlify AI Gateway needs ${NETLIFY_GATEWAY_ENV.join(" and ")} together. Unset both to use the injected pair, or set both.`,
      );
    }

    return { url: joinUrl(base, "v1/chat/completions"), headers: bearer(key) };
  }

  const key = address.keys
    .map((source) =>
      "env" in source ? getSecret(source.env) : (request.headers.get(source.header) ?? undefined),
    )
    .find(Boolean);

  return {
    url: joinUrl(address.baseUrl, "chat/completions"),
    headers: { ...bearer(key), ...address.headers },
  };
}

export interface RelayRequest {
  request: Request;
  ai: AiServerConfig;
  /** Model ids this deployment allows, from the client config. */
  models: string[];
  /** The signed-in editor, which is what a per-editor limit binds to. */
  caller: string;
  /** How a refusal is spelled, so the relay does not restate the server's envelope. */
  fail: (message: string, status: number) => Response;
}

export async function relay(options: RelayRequest): Promise<Response> {
  const { ai, caller, fail } = options;
  const slot = rateLimiter(ai).acquire(caller);

  if (!slot.ok) {
    return fail(
      slot.reason === "concurrency"
        ? "Too many assistant requests at once. Wait for the current one to finish."
        : "Too many assistant requests. Wait a moment and try again.",
      429,
    );
  }

  // A cancelled request never reaches the stream's end, so the slot is freed
  // from here too; `release` is idempotent, so both paths may run.
  options.request.signal.addEventListener("abort", slot.release, { once: true });

  let response: Response;
  try {
    response = await forward(options);
  } catch (err) {
    slot.release();

    throw err;
  }

  if (!response.ok || !response.body) {
    slot.release();

    return response;
  }

  // A streaming answer occupies the gateway until its last token, which is what
  // the concurrency limit is meant to bound, so the slot is held until the body
  // ends or is cancelled, not until its headers arrive.
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          slot.release();
          controller.close();

          return;
        }

        controller.enqueue(value);
      } catch (err) {
        slot.release();
        controller.error(err);
      }
    },
    async cancel(reason) {
      slot.release();
      await reader.cancel(reason);
    },
  });

  return new Response(body, response);
}

async function forward({ request, ai, models, fail }: RelayRequest): Promise<Response> {
  const { limits } = ai;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(request, limits.maxRequestBytes));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return fail(err.message, 413);

    return fail("Malformed request body.", 400);
  }

  const result = requestBodySchema.safeParse(parsed);

  if (!result.success) {
    return fail("A request object is required.", 400);
  }

  const body = result.data;

  const model = body.model;

  // Without an explicit model, the gateway would pick one outside the list.
  if (typeof model !== "string") return fail("A model is required.", 400);

  if (!models.includes(model)) return fail(`Model not allowed: ${model}`, 400);

  let gateway: Gateway;
  try {
    gateway = resolveGateway(ai.gateway, request);
  } catch (err) {
    console.error("[astronaut-cms] Failed to resolve AI gateway:", err);

    return fail(errorMessage(err, "Gateway not configured"), 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(gateway.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...gateway.headers },
      body: JSON.stringify(bounded(body, limits.maxOutputTokens)),
      // Tie the upstream call to the browser's request: when the user stops a
      // run or navigates away, the gateway request is cancelled with it instead
      // of streaming on into a response nobody is reading.
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return fail("The request was cancelled.", 499);

    // A connection-level failure (gateway down, DNS, TLS) never reaches the
    // browser as a useful status, so log the full error and return a clear one.
    console.error(`[astronaut-cms] Failed to reach AI gateway at ${gateway.url}:`, err);

    return fail(`Could not reach the AI gateway at ${gateway.url}.`, 502);
  }

  if (!upstream.ok) {
    // Forward the gateway's error body verbatim (the client provider parses
    // `{ error: { message } }`) and log the complete response server-side.
    const detail = await upstream.text();

    console.error(`[astronaut-cms] AI gateway returned HTTP ${upstream.status}: ${detail}`);

    return new Response(detail, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}
