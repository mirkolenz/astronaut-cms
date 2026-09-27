/**
 * A stateless streaming proxy between the browser-side agent loop and the
 * configured AI gateway. It holds no secret of its own (the gateway credential
 * comes from the config or the platform-injected environment) and answers only
 * to a request the CMS server has already authenticated.
 *
 * The agent loop stays in the browser deliberately. Every request through here
 * is one model call, so nothing depends on how long a whole turn takes and no
 * serverless duration limit can cut a conversation in half; the tools the model
 * calls go through the same operation registry as the UI, so they are bounded by
 * the same rules rather than by where they run.
 */
import type { AiServerConfig } from "../integration/types.ts";
import { AI_API_KEY_ENV, gatewayEndpoint, type AiGateway } from "../shared/ai.ts";
import { BodyTooLargeError, readBody } from "../shared/http.ts";
import { RateLimiter } from "../shared/rate-limit.ts";
import { unreachable } from "../shared/unreachable.ts";
import type { EnvReader } from "../shared/runtime-env.ts";
import { joinUrl } from "../shared/url.ts";

/** The `Authorization` header for a gateway credential, or none when it has none. */
export const bearer = (token: string | undefined): Record<string, string> =>
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

// The gateway type comes from static config; credentials come from the config
// when set, otherwise from the platform-injected environment (Netlify/Vercel),
// so nothing has to be configured at deploy time.
function resolveGateway(gateway: AiGateway, getEnv: EnvReader): Gateway {
  switch (gateway.type) {
    case "vercel": {
      const key = getEnv("AI_GATEWAY_API_KEY") ?? getEnv("VERCEL_OIDC_TOKEN");

      return { url: "https://ai-gateway.vercel.sh/v1/chat/completions", headers: bearer(key) };
    }

    // Both are addressed from the config alone (see `gatewayEndpoint`), which is
    // what also lets a browser reach them under `byok`. The credential is the
    // only thing that differs between the two sides.
    case "cloudflare":
    case "custom": {
      const { baseUrl, headers } = gatewayEndpoint(gateway);
      const key =
        gateway.type === "cloudflare"
          ? getEnv("CLOUDFLARE_API_TOKEN")
          : getEnv(AI_API_KEY_ENV);

      return { url: joinUrl(baseUrl, "chat/completions"), headers: { ...bearer(key), ...headers } };
    }

    case "netlify": {
      const base = getEnv("NETLIFY_AI_GATEWAY_BASE_URL") ?? getEnv("OPENAI_BASE_URL");
      const key = getEnv("NETLIFY_AI_GATEWAY_KEY") ?? getEnv("OPENAI_API_KEY");

      if (!base) {
        throw new Error("Netlify AI Gateway credentials are not available in this environment.");
      }

      return { url: joinUrl(base, "v1/chat/completions"), headers: bearer(key) };
    }

    default:
      return unreachable(gateway, "Unknown AI gateway");
  }
}

export interface RelayRequest {
  request: Request;
  getEnv: EnvReader;
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

  if (!response.body) {
    slot.release();

    return response;
  }

  // A streaming answer occupies the gateway until its last token, which is what
  // the concurrency limit is meant to bound — so the slot is held until the body
  // ends, not until its headers arrive.
  return new Response(
    response.body.pipeThrough(new TransformStream({ flush: slot.release })),
    response,
  );
}

async function forward({ request, getEnv, ai, models, fail }: RelayRequest): Promise<Response> {
  const { limits } = ai;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(request, limits.maxRequestBytes)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BodyTooLargeError) return fail(err.message, 413);

    return fail("Malformed request body.", 400);
  }

  const model = body.model;

  if (typeof model === "string" && !models.includes(model)) {
    return fail(`Model not allowed: ${model}`, 400);
  }

  let gateway: Gateway;
  try {
    gateway = resolveGateway(ai.gateway, getEnv);
  } catch (err) {
    console.error("[astronaut-cms] Failed to resolve AI gateway:", err);

    return fail(err instanceof Error ? err.message : "Gateway not configured", 500);
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
