/**
 * Platform-agnostic relay core: a pure Web-standard streaming proxy between the
 * browser-side agent loop and the configured AI gateway. It holds no secret of
 * its own (the gateway credential comes from the config or the platform-injected
 * environment) and gates access by re-validating the caller's Git provider token
 * against the configured repository. Request/response bodies are proxied verbatim
 * so the client can keep using a plain OpenAI-compatible provider.
 *
 * `endpoint.ts` is the Astro-route shell over this core. To also run it on a true
 * edge runtime later (e.g. a Netlify Edge Function, to escape the serverless
 * duration limit) add a second thin shell that calls `handle`, without changing
 * this file:
 *   1. Expose this module from the package (a `./ai-handler` entry in
 *      package.json `exports` and a matching Vite lib entry in vite.config.ts).
 *   2. Have the integration generate `netlify/edge-functions/astronaut-cms-ai.mjs`
 *      at build time: it imports `handle`, bakes in the `RelayConfig` (storage +
 *      gateway, read from the integration config), reads secrets via
 *      `Netlify.env.get`, and declares
 *      `export const config = { path: "/_astronaut-cms/ai/chat/completions" }`.
 *   3. Skip injecting the Astro route on Netlify deploys so the two do not
 *      handle the same path.
 */
import type { AiGateway, AiServerConfig } from "../integration/types.ts";
import { bearer, bearerToken, denyUnlessWritable, type AccessConfig } from "../shared/access.ts";
import { BodyTooLargeError, readBody } from "../shared/http.ts";
import { RateLimiter } from "../shared/rate-limit.ts";
import { jsonError } from "../shared/response.ts";
import { unreachable } from "../shared/unreachable.ts";
import type { EnvReader } from "../shared/runtime-env.ts";
import { joinUrl } from "../shared/url.ts";

export interface RelayConfig extends AccessConfig {
  /** Null when the assistant is disabled, in which case this route is not injected. */
  ai: AiServerConfig | null;
  models?: string[];
}

// One limiter per warm instance. The config is a build-time constant, so it
// cannot change under a running instance and the limiter is simply built once.
let limiter: RateLimiter | null = null;

function rateLimiter({ limits }: AiServerConfig): RateLimiter {
  limiter ??= new RateLimiter({
    requests: limits.requestsPerMinute,
    windowMs: 60_000,
    concurrency: limits.concurrency,
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

    case "cloudflare": {
      // OpenAI-compatible REST endpoint (the older `/compat/chat/completions`
      // path is deprecated). The gateway is selected by header, and a Cloudflare
      // API token with AI Gateway permission authenticates the call. Provider
      // credentials are managed by the gateway (unified billing).
      const gatewayId = gateway.gatewayId ?? "default";
      const key = getEnv("CLOUDFLARE_API_TOKEN");

      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${gateway.accountId}/ai/v1/chat/completions`,
        headers: { ...bearer(key), "cf-aig-gateway-id": gatewayId },
      };
    }

    case "custom": {
      const key = getEnv("ASTRONAUT_CMS_AI_API_KEY");

      return { url: joinUrl(gateway.baseUrl, "chat/completions"), headers: bearer(key) };
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

export async function handle(
  request: Request,
  getEnv: EnvReader,
  config: RelayConfig,
): Promise<Response> {
  const denied = await denyUnlessWritable(request, config);

  if (denied) return denied;

  if (!config.ai) {
    return jsonError("AI gateway is not configured.", 500);
  }

  // Write access is the only identity an injected route has, so it is also what
  // a per-editor limit binds to.
  const slot = rateLimiter(config.ai).acquire(bearerToken(request) ?? "");

  if (!slot.ok) {
    return jsonError(
      slot.reason === "concurrency"
        ? "Too many assistant requests at once. Wait for the current one to finish."
        : "Too many assistant requests. Wait a moment and try again.",
      429,
    );
  }

  // A cancelled request never reaches the stream's end, so the slot is freed
  // from here too; `release` is idempotent, so both paths may run.
  request.signal.addEventListener("abort", slot.release, { once: true });

  let response: Response;
  try {
    response = await relay(request, getEnv, config, config.ai);
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

async function relay(
  request: Request,
  getEnv: EnvReader,
  config: RelayConfig,
  ai: AiServerConfig,
): Promise<Response> {
  const { limits } = ai;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(request, limits.maxRequestBytes)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BodyTooLargeError) return jsonError(err.message, 413);

    return jsonError("Malformed request body.", 400);
  }

  const model = body.model;

  if (config.models && typeof model === "string" && !config.models.includes(model)) {
    return jsonError(`Model not allowed: ${model}`, 400);
  }

  let gateway: Gateway;
  try {
    gateway = resolveGateway(ai.gateway, getEnv);
  } catch (err) {
    console.error("[astronaut-cms] Failed to resolve AI gateway:", err);

    return jsonError(err instanceof Error ? err.message : "Gateway not configured", 500);
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
    if (request.signal.aborted) return jsonError("The request was cancelled.", 499);

    // A connection-level failure (gateway down, DNS, TLS) never reaches the
    // browser as a useful status, so log the full error and return a clear one.
    console.error(`[astronaut-cms] Failed to reach AI gateway at ${gateway.url}:`, err);

    return jsonError(
      `Could not reach the AI gateway at ${gateway.url}.${err instanceof Error ? ` ${err.message}` : ""}`,
      502,
    );
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
