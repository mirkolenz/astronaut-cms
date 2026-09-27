/**
 * Platform-agnostic OAuth token endpoint for GitHub's redirect login flow: it
 * forwards the browser's token request verbatim, adds the client secret, and
 * hands the response back. It stores nothing, issues nothing of its own, and
 * holds no session.
 *
 * That makes it a plain OAuth token endpoint, and safe to leave unauthenticated:
 * a request is only worth anything when it carries a live authorization code,
 * which GitHub hands exclusively to the app's registered callback URL and which
 * PKCE binds to the browser that started the flow.
 *
 * `endpoint.ts` is the Astro-route shell over this core; the split mirrors the
 * AI relay in `../ai/handler.ts` so a true edge runtime can reuse it unchanged.
 */
import { GITHUB_CLIENT_SECRET_ENV, GITHUB_TOKEN_ENDPOINT } from "../shared/auth.ts";
import { json } from "../shared/response.ts";
import type { EnvReader } from "../shared/runtime-env.ts";

/** A token response is never cacheable, whether it carries a token or an error. */
const NO_STORE = { "cache-control": "no-store" };

/** An OAuth 2.0 error response, the shape the browser's OAuth client parses. */
function oauthError(error: string, description: string, status: number): Response {
  return json({ error, error_description: description }, status, NO_STORE);
}

/** `clientId` is the configured GitHub app's; a request naming any other is refused. */
export async function handle(
  request: Request,
  getEnv: EnvReader,
  clientId: string | undefined,
): Promise<Response> {
  if (!clientId) {
    return oauthError("server_error", "GitHub storage is not configured.", 500);
  }

  const clientSecret = getEnv(GITHUB_CLIENT_SECRET_ENV);

  if (!clientSecret) {
    console.error(`[astronaut-cms] ${GITHUB_CLIENT_SECRET_ENV} is not set.`);

    return oauthError(
      "server_error",
      `GitHub sign-in is not configured: ${GITHUB_CLIENT_SECRET_ENV} is not set on the server.`,
      500,
    );
  }

  const params = new URLSearchParams(await request.text());

  // Only the code exchange is relayed. Every other grant would spend the secret
  // on a request this flow never makes, so it is refused rather than forwarded.
  if (params.get("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Only authorization_code is supported.", 400);
  }

  if (params.get("client_id") !== clientId) {
    return oauthError("invalid_client", "Unknown client_id.", 401);
  }

  params.set("client_secret", clientSecret);

  let upstream: Response;
  try {
    upstream = await fetch(GITHUB_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: params,
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted)
      return oauthError("invalid_request", "The request was cancelled.", 499);

    console.error("[astronaut-cms] Failed to reach the GitHub token endpoint:", err);

    return oauthError("server_error", "Could not reach GitHub to complete sign-in.", 502);
  }

  const body = await upstream.text();
  const parsed = upstream.ok ? safeParse(body) : null;

  // GitHub answers a failed exchange with HTTP 200 and an `error` member rather
  // than the 400 the spec calls for, which every OAuth client reads as a
  // malformed success. Restate it as the error response it actually is, so the
  // browser surfaces GitHub's own description instead of a parse failure.
  if (parsed?.error) {
    return oauthError(parsed.error, parsed.error_description ?? parsed.error, 400);
  }

  // Already a JSON string, so it is passed through rather than re-serialized.
  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

function safeParse(body: string): { error?: string; error_description?: string } | null {
  try {
    return JSON.parse(body) as { error?: string; error_description?: string };
  } catch {
    return null;
  }
}
