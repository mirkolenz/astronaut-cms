/**
 * The whole CMS server, as one platform-agnostic handler over Web `Request` and
 * `Response`. `endpoint.ts` is the thin Astro shell; nothing here knows about
 * Astro, Node or Workers, which is what keeps it runnable on all of them.
 *
 * Everything the browser can reach is here, and it is a short list: find out
 * whether there is a session, start one, end one, run one named operation, and
 * move media bytes. Content, media and the changeset are all the single `rpc`
 * path into {@link dispatch}, so the reachable surface is the operation registry
 * rather than one route per thing the CMS happens to do.
 */
import serverConfig from "virtual:astronaut-cms/server";
import clientConfig from "virtual:astronaut-cms/config";
import { API_BASE, API_LOGIN, CF_ACCESS_HEADER, SESSION_SECRET_ENV } from "../shared/auth.ts";
import { ContentValidationError, type Diagnostic } from "../shared/diagnostics.ts";
import { BodyTooLargeError, HARDENING_HEADERS, readBody } from "../shared/http.ts";
import { conformTrailingSlash } from "../shared/url.ts";
import type { BindingReader, EnvReader } from "../shared/runtime-env.ts";
import { RateLimiter, callerAddress, limited } from "../shared/rate-limit.ts";
import { relay } from "../ai/handler.ts";
import { createContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import { MergeConflictError } from "./storage/types.ts";
import { dispatch } from "./operations.ts";
import {
  authorizationUrl,
  clientSecret,
  exchangeCode,
  OAuthError,
  refreshSession,
  type ProviderConfig,
} from "./oauth.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  cmsCookie,
  cookiePath,
  isSameOrigin,
  issue,
  needsRefresh,
  readCookie,
  verify,
  type Session,
} from "./session.ts";

/** An RPC body is entry data, which is text. A media upload takes its own route. */
const MAX_RPC_BYTES = 4 * 1024 * 1024;

/** Largest upload this server will take through itself, for a store that cannot presign. */
const MAX_PROXY_UPLOAD_BYTES = 25 * 1024 * 1024;

const STATE_COOKIE = "astronaut_cms_oauth";
const STATE_MAX_AGE = 600;

/**
 * Sign-in is the only thing an unauthenticated caller can make this server do
 * work for, and redeeming a code means an outbound request to the provider. A
 * flood of those costs invocations and risks the provider rate-limiting the
 * deployment's address, which would break sign-in for everyone — so the cap is
 * on the outbound call rather than on the bytes.
 *
 * Generous against real use: a deployment sees one exchange per editor per
 * session. Keyed by caller address where the platform supplies one, and by a
 * shared bucket where it does not.
 */
const signIn = new RateLimiter({ requests: 20, windowMs: 60_000, concurrency: 4 });

/**
 * What one signed-in editor may ask of the server. The admin is chatty — a
 * navigation is several reads — so this is set well above anything a person
 * produces, and exists to bound a runaway agent loop or a compromised tab
 * rather than to pace the interface.
 */
const rpc = new RateLimiter({ requests: 300, windowMs: 60_000, concurrency: 12 });

const tooMany = (message: string) => () => new HttpError(message, 429);

/** What the state cookie carries between the redirect out and the redirect back. */
type LoginState = { state: string };

/**
 * What the admin page needs to decide what to render. It is deliberately the
 * whole of the answer: nothing here identifies a token, and an unauthenticated
 * request learns only that it is unauthenticated.
 */
export interface AdminState {
  signedIn: boolean;
  /** Where the sign-in link goes. */
  loginUrl: string;
  /** What the provider said, when the editor has just come back from a failed callback. */
  error?: string;
  /** Whether to start the redirect without waiting for a click. */
  autoLogin: boolean;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...HARDENING_HEADERS,
      ...headers,
    },
  });
}

function fail(message: string, status: number, validation?: Diagnostic[]): Response {
  return json({ error: { message, ...(validation && { validation }) } }, status);
}

/** The session cookie, or the expired form of it that signing out sets. */
function sessionCookie(url: URL, value?: string): string {
  return cmsCookie({ name: SESSION_COOKIE, url, apiBase: API_BASE, value });
}

/** The token inside it, whose own `exp` matches the cookie's `Max-Age`. */
const issueSession = (session: Session, secret: string): Promise<string> =>
  issue("session", session, secret, SESSION_TTL);

/** The CMS's own absolute URL for a path under {@link API_BASE} or the admin. */
function siteUrl(url: URL, path: string): string {
  const prefix = cookiePath(url, API_BASE).slice(0, -API_BASE.length);

  return conformTrailingSlash(
    new URL(`${prefix}${path}`, url.origin).href,
    clientConfig.trailingSlash,
  );
}

/**
 * What the session cookie is encrypted with.
 *
 * By default the OAuth client secret the deployment already holds: it is high
 * entropy, server-only, identical across every instance, and stable across
 * deploys, which is exactly what a cookie key has to be. The key itself is
 * derived from it (HKDF, see `sealingKey`), so the two are separate keys that
 * happen to share one input, and rotating the client secret — the thing you do
 * on compromise anyway — invalidates every session with it.
 *
 * `ASTRONAUT_CMS_SESSION_SECRET` overrides it, for a deployment that wants to
 * expire sessions without touching its OAuth app, or to share one session across
 * several services.
 */
function sessionSecret(provider: ProviderConfig, getEnv: EnvReader): string {
  return getEnv(SESSION_SECRET_ENV) ?? clientSecret(provider, getEnv);
}

/** The configured provider, or null when this deployment stores content locally. */
function providerConfig(): ProviderConfig | null {
  const { storage } = serverConfig;

  if (storage.type === "github") {
    return { provider: "github", clientId: storage.clientId, target: storage.repo, scopes: [] };
  }

  if (storage.type === "gitlab") {
    return {
      provider: "gitlab",
      clientId: storage.clientId,
      target: storage.project,
      instanceUrl: storage.instanceUrl,
      scopes: storage.scopes,
    };
  }

  return null;
}

/**
 * `astro dev` against the working tree has no provider and therefore no sign-in:
 * the editor is whoever can reach the dev server, which is the same trust
 * boundary the dev server itself has.
 */
const LOCAL_SESSION: Session = { provider: "local", token: "", login: "local" };

/**
 * What a request turned out to be. `misconfigured` is kept distinct from
 * `anonymous` because the two are answered in different places: the API treats
 * both as "not signed in", while the sign-in page is the one screen where an
 * operator will see why nobody can sign in at all.
 */
type Authenticated =
  | {
      kind: "session";
      session: Session;
      /** Set when the token was renewed and the browser has to be given the new cookie. */
      cookie?: string;
    }
  | { kind: "anonymous" }
  | { kind: "misconfigured"; error: string };

async function authenticate(
  request: Request,
  url: URL,
  getEnv: EnvReader,
  provider: ProviderConfig | null,
): Promise<Authenticated> {
  if (!provider) return { kind: "session", session: LOCAL_SESSION };

  const raw = readCookie(request, SESSION_COOKIE);

  // No cookie, no work: an anonymous request costs a header lookup and nothing
  // else — no environment read, no key derivation, and no way to learn from the
  // answer whether the deployment is configured.
  if (!raw) return { kind: "anonymous" };

  let secret: string;
  try {
    secret = sessionSecret(provider, getEnv);
  } catch (err) {
    // A deployment that cannot reach its secret cannot have issued this cookie
    // either, so whoever sent one is told nothing more than "not signed in".
    return { kind: "misconfigured", error: describeFailure(err) };
  }

  const session = await verify<Session>("session", raw, secret);

  if (!session || session.provider !== provider.provider) return { kind: "anonymous" };

  if (!needsRefresh(session)) return { kind: "session", session };

  const renewed = await refreshSession(provider, getEnv, session);

  if (!renewed) return { kind: "anonymous" };

  return {
    kind: "session",
    session: renewed,
    cookie: sessionCookie(url, await issueSession(renewed, secret)),
  };
}

const describeFailure = (err: unknown): string =>
  err instanceof OAuthError ? err.message : "Sign-in is unavailable.";

/**
 * Whether this request may see the admin at all.
 *
 * The admin page is the largest unauthenticated surface the CMS has — a page, a
 * bundle and the client config — and none of it is worth anything without a
 * session. Asking here means an anonymous request is answered with a sign-in
 * link and nothing else.
 */
export async function readAdminState(
  request: Request,
  url: URL,
  getEnv: EnvReader,
): Promise<AdminState> {
  const provider = providerConfig();
  const outcome = await authenticate(request, url, getEnv, provider);

  // Whatever the provider put on the callback, unless the deployment has a
  // problem of its own to report first.
  const error =
    outcome.kind === "misconfigured"
      ? outcome.error
      : (url.searchParams.get("error") ?? undefined);

  return {
    signedIn: outcome.kind === "session",
    loginUrl: siteUrl(url, API_LOGIN),
    error,
    // Already signed in at the edge, so the provider round trip is invisible.
    // Suppressed once a sign-in has just been attempted, so a browser that drops
    // the session cookie lands on the page rather than in a redirect loop.
    autoLogin:
      request.headers.get(CF_ACCESS_HEADER) != null &&
      readCookie(request, STATE_COOKIE) == null &&
      !error,
  };
}

export async function handle(
  request: Request,
  getEnv: EnvReader,
  getBinding: BindingReader,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname
    .slice(url.pathname.indexOf(API_BASE) + API_BASE.length)
    .replace(/\/+$/, "");

  try {
    return await route(path, request, url, getEnv, getBinding);
  } catch (err) {
    return toResponse(err);
  }
}

async function route(
  path: string,
  request: Request,
  url: URL,
  getEnv: EnvReader,
  getBinding: BindingReader,
): Promise<Response> {
  // A cookie rides along with any request this origin receives, whoever caused
  // it, so anything that changes state has to prove the admin itself asked.
  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return fail("Cross-origin request blocked.", 403);
  }

  // Both halves of the sign-in dance share a budget: the redirect out mints a
  // state cookie, and only a caller holding one can reach the exchange.
  if (path === "/login" || path === "/callback") {
    return limited(
      signIn,
      callerAddress(request),
      tooMany("Too many sign-in attempts. Wait a moment and try again."),
      () => (path === "/login" ? startLogin(url, getEnv) : completeLogin(request, url, getEnv)),
    );
  }

  if (path === "/logout") {
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(url) });
  }

  const authenticated = await authenticate(request, url, getEnv, providerConfig());

  // A misconfigured deployment reads as unsigned here; it says why on the
  // sign-in page, not to whoever sent a cookie.
  if (authenticated.kind !== "session") return fail("Not signed in.", 401);

  const { session, cookie } = authenticated;
  const extra: Record<string, string> = cookie ? { "set-cookie": cookie } : {};
  const ctx = createContext(session, getEnv, getBinding);

  if (path === "/rpc" && request.method === "POST") {
    const { op, input } = JSON.parse(await readBody(request, MAX_RPC_BYTES)) as {
      op?: unknown;
      input?: unknown;
    };

    if (typeof op !== "string") return fail("An operation name is required.", 400);

    const result = await limited(
      rpc,
      session.login,
      tooMany("Too many requests. Wait a moment and try again."),
      () => dispatch(ctx, op, input ?? {}),
    );

    return json(result, 200, extra);
  }

  if (path.startsWith("/media/") && request.method === "GET") {
    const library = await ctx.media();
    const content = await library.readMedia(decodeURIComponent(path.slice("/media/".length)));

    if ("redirect" in content) {
      return new Response(null, {
        status: 302,
        headers: {
          location: content.redirect,
          // A redirect is uncacheable unless it says otherwise, and without this
          // every render of the same thumbnail comes back here. Private, because
          // where it points depends on who asked, and short, because a signed
          // destination expires.
          "cache-control": "private, max-age=300",
          ...extra,
        },
      });
    }

    return new Response(content.bytes, {
      headers: {
        "content-type": content.contentType,
        // The library is the editor's own repository or bucket, so it is cached
        // per browser and never by a shared proxy.
        "cache-control": "private, max-age=300",
        ...HARDENING_HEADERS,
        ...extra,
      },
    });
  }

  if (path === "/ai/chat/completions" && request.method === "POST") {
    const { ai } = serverConfig;

    if (!ai) return fail("The assistant is not configured.", 404);

    return relay({
      request,
      getEnv,
      ai,
      models: clientConfig.ai?.models ?? [],
      caller: session.login,
      fail,
    });
  }

  if (path === "/upload" && request.method === "PUT") {
    const params = url.searchParams;
    const uploadPath = params.get("path");

    if (!uploadPath) return fail("An upload path is required.", 400);

    const bytes = new Uint8Array(await readArrayBuffer(request, MAX_PROXY_UPLOAD_BYTES));

    await (await ctx.media()).uploadMedia(uploadPath, bytes, params.get("overwrite") === "true");

    return json({ ok: true }, 200, extra);
  }

  return fail("Not found.", 404);
}

async function startLogin(url: URL, getEnv: EnvReader): Promise<Response> {
  const provider = providerConfig();

  if (!provider) return fail("This deployment does not sign in.", 400);

  const state = crypto.randomUUID();
  const redirectUri = siteUrl(url, `${API_BASE}/callback`);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizationUrl(provider, redirectUri, state),
      // The `state` lives in its own short-lived sealed cookie rather than in
      // `sessionStorage`, so script in the admin can neither read it nor plant one.
      "set-cookie": cmsCookie({
        name: STATE_COOKIE,
        url,
        apiBase: API_BASE,
        value: await issue(
          "oauth-state",
          { state } satisfies LoginState,
          sessionSecret(provider, getEnv),
          STATE_MAX_AGE,
        ),
        maxAge: STATE_MAX_AGE,
      }),
      "cache-control": "no-store",
    },
  });
}

async function completeLogin(request: Request, url: URL, getEnv: EnvReader): Promise<Response> {
  const provider = providerConfig();

  if (!provider) return fail("This deployment does not sign in.", 400);

  const admin = siteUrl(url, clientConfig.mountPoint);
  const failed = (message: string) =>
    Response.redirect(`${admin}?error=${encodeURIComponent(message)}`, 302);

  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) return failed(error);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = readCookie(request, STATE_COOKIE);
  const expected = stateCookie
    ? await verify<LoginState>("oauth-state", stateCookie, sessionSecret(provider, getEnv))
    : null;

  if (!code || !state || expected?.state !== state) {
    return failed("The sign-in link expired. Try again.");
  }

  const session = await exchangeCode(provider, getEnv, code, siteUrl(url, `${API_BASE}/callback`));

  return new Response(null, {
    status: 302,
    headers: {
      location: admin,
      "cache-control": "no-store",
      "set-cookie": sessionCookie(url, await issueSession(session, sessionSecret(provider, getEnv))),
    },
  });
}

/** Reads a body of unknown type, refusing anything over `maxBytes` as it arrives. */
async function readArrayBuffer(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);

  const buffer = await request.arrayBuffer();

  if (buffer.byteLength > maxBytes) throw new BodyTooLargeError(maxBytes);

  return buffer;
}

function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return fail(err.message, err.status);
  if (err instanceof MergeConflictError) return fail(err.message, 409);
  if (err instanceof ContentValidationError) return fail(err.message, 422, err.diagnostics);
  if (err instanceof BodyTooLargeError) return fail(err.message, 413);
  if (err instanceof OAuthError) return fail(err.message, 400);

  console.error("[astronaut-cms] Request failed:", err);

  return fail(err instanceof Error ? err.message : "Request failed", 500);
}
