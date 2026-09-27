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
import {
  API_BASE,
  API_CALLBACK,
  API_LOGIN,
  CF_ACCESS_HEADER,
  SESSION_SECRET_ENV,
  type SessionState,
} from "../shared/auth.ts";
import { ContentValidationError, type Diagnostic } from "../shared/diagnostics.ts";
import { BodyTooLargeError, HARDENING_HEADERS, readBody, readBytes } from "../shared/http.ts";
import { isActiveContentType } from "../shared/media.ts";
import { conformTrailingSlash } from "../shared/url.ts";
import type { BindingReader, EnvReader } from "../shared/runtime-env.ts";
import { RateLimiter, callerAddress, limited } from "../shared/rate-limit.ts";
import { Coalesced } from "../shared/coalesce.ts";
import { relay } from "../ai/handler.ts";
import { createContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import { MergeConflictError } from "./storage/types.ts";
import { dispatch } from "./operations.ts";
import {
  authorizationUrl,
  challengeFor,
  clientSecret,
  createVerifier,
  exchangeCode,
  OAuthError,
  refreshSession,
  revokeSession,
  verifyAccess,
  type ProviderConfig,
} from "./oauth.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  basePath,
  cmsCookie,
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

/** Carries the PKCE verifier between the redirect out and the redirect back. */
const LOGIN_COOKIE = "astronaut_cms_login";
const LOGIN_MAX_AGE = 600;

/**
 * Sign-in is the only thing an unauthenticated caller can make this server do
 * work for, and redeeming a code means an outbound request to the provider. A
 * flood of those costs invocations and risks the provider rate-limiting the
 * deployment's address, which would break sign-in for everyone — so the cap is
 * on the outbound call rather than on the bytes.
 *
 * Generous against real use: a deployment sees one exchange per editor per
 * session.
 */
const signIn = new RateLimiter({ requests: 20, windowMs: 60_000, concurrency: 4 });

/**
 * The same thing charged to everybody at once. Behind a proxy the forwarded
 * address above is trustworthy, but reached directly it is the caller's to
 * spell and to rotate, which makes the per-address bucket alone a formality.
 * This is the ceiling that holds whatever the request claims to be, set high
 * enough that it is only ever reached by a flood.
 */
const signInTotal = new RateLimiter({ requests: 120, windowMs: 60_000, concurrency: 16 });

/**
 * What one signed-in editor may ask of the server. The admin is chatty — a
 * navigation is several reads — so this is set well above anything a person
 * produces, and exists to bound a runaway agent loop or a compromised tab
 * rather than to pace the interface.
 */
const rpc = new RateLimiter({ requests: 300, windowMs: 60_000, concurrency: 12 });

const tooMany = (message: string) => () => new HttpError(message, 429);

/**
 * What the sign-in cookie carries. The verifier alone: the challenge derived
 * from it is what the provider echoes back as `state`, so there is no second
 * secret to mint, to carry, or to keep in step with it.
 */
type Login = { verifier: string };

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

/** The site's `base`, read off the API path every CMS request is under. */
const sitePath = (url: URL): string => basePath(url.pathname, API_BASE);

/**
 * Where the CMS's cookies apply: its own API routes and nothing else, so they are
 * never attached to a request for the site's own pages. The admin page is a
 * static shell that reads no session (see `astro/admin.astro`), which is what
 * lets the scope stay this narrow.
 */
const cookieScope = (url: URL): string => `${sitePath(url)}${API_BASE}`;

/** The session cookie, or the expired form of it that signing out sets. */
function sessionCookie(url: URL, value?: string): string {
  return cmsCookie({ name: SESSION_COOKIE, url, path: cookieScope(url), value });
}

/**
 * The sign-in cookie, or the expired form of it every callback sets. A verifier
 * is spent on the one code it was minted for, so it is torn up whichever way the
 * callback ends rather than left to time out.
 */
function loginCookie(url: URL, value?: string): string {
  return cmsCookie({
    name: LOGIN_COOKIE,
    url,
    path: cookieScope(url),
    value,
    maxAge: LOGIN_MAX_AGE,
  });
}

/** The token inside it, whose own `exp` matches the cookie's `Max-Age`. */
const issueSession = (session: Session, secret: string): Promise<string> =>
  issue("session", session, secret, SESSION_TTL);

/** The CMS's own absolute URL for a path under {@link API_BASE} or the admin. */
function siteUrl(url: URL, path: string): string {
  return conformTrailingSlash(
    new URL(`${sitePath(url)}${path}`, url.origin).href,
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
  /**
   * A real session whose editor no longer has repository access. It still
   * carries the session, because signing out is the one thing such an editor is
   * allowed to do and revoking the provider's token is part of it.
   */
  | { kind: "revoked"; error: string; session: Session }
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

  if (!needsRefresh(session)) return revocable(provider, session);

  const { refreshToken } = session;

  if (!refreshToken) return { kind: "anonymous" };

  // Shared, because both providers rotate the refresh token: the several
  // requests one navigation fires would otherwise each spend the same one, the
  // first would win, and the rest would be handed a token already invalidated.
  const renewed = await refreshes.run(refreshToken, () =>
    refreshSession(provider, getEnv, refreshToken, session.login),
  );

  if (!renewed) return { kind: "anonymous" };

  return revocable(provider, renewed, sessionCookie(url, await issueSession(renewed, secret)));
}

/**
 * The session, unless the editor behind it has lost repository access.
 *
 * Here rather than at a route, so a route added later cannot forget it.
 */
async function revocable(
  provider: ProviderConfig,
  session: Session,
  cookie?: string,
): Promise<Authenticated> {
  const error = await revoked(provider, session.token);

  return error ? { kind: "revoked", error, session } : { kind: "session", session, cookie };
}

const describeFailure = (err: unknown): string =>
  err instanceof OAuthError ? err.message : "Sign-in is unavailable.";

/** How long a confirmed authorization stands before the provider is asked again. */
const ACCESS_TTL_MS = 5 * 60_000;

/**
 * Token to the check that cleared it. The *promise* is shared, not just its
 * result, so the several requests one admin navigation fires make one provider
 * call between them rather than each starting their own on a cold instance.
 */
const checks = new Coalesced<string | undefined>(ACCESS_TTL_MS);

/**
 * How long a completed refresh answers for the token it consumed. Long enough to
 * outlast a request that read the cookie just before another request spent it,
 * short enough that no session is served from here for its own sake.
 */
const REFRESH_TTL_MS = 60_000;

/** Refresh token to the session that replaced it. */
const refreshes = new Coalesced<Session | null>(REFRESH_TTL_MS);

/**
 * Why this token may no longer be used, or undefined while it still may.
 *
 * Every call the CMS makes on the editor's own token is re-decided by the
 * provider, so for the repository a stale session is already harmless. The
 * surfaces that are not are the reason this exists: the assistant relay and an
 * object-store media library both spend the *deployment's* credentials and ask
 * the provider nothing, so without this, losing access would still leave someone
 * able to spend the AI account and rewrite the bucket until their cookie expired
 * thirty days later.
 */
function revoked(provider: ProviderConfig, token: string): Promise<string | undefined> {
  // Fails closed: a provider outage reads as "no longer permitted", which is the
  // right direction for a gate and the same answer signing in would give.
  return checks.run(token, () =>
    verifyAccess(provider, token).then(
      () => undefined,
      (err: unknown) => describeFailure(err),
    ),
  );
}

/**
 * Answers the shell's one anonymous question: is there a session, and if so,
 * what is this deployment?
 *
 * The only route that answers without one, which is what lets the admin page be
 * a static shell. An anonymous caller learns whether it is signed in and where
 * to go to change that, and nothing else.
 */
function sessionState(
  request: Request,
  url: URL,
  authenticated: Authenticated,
): SessionState {
  return {
    loginUrl: siteUrl(url, API_LOGIN),
    // Already signed in at the edge, so the provider round trip can be made
    // invisible. Suppressed once a sign-in is in flight, so a browser that drops
    // the session cookie lands on the page rather than in a redirect loop; the
    // shell suppresses it again once anything has gone wrong.
    autoLogin:
      request.headers.get(CF_ACCESS_HEADER) != null && readCookie(request, LOGIN_COOKIE) == null,
    // A deployment that cannot reach its own secret, or an editor who has lost
    // access, is the one thing worth reporting: both leave someone staring at a
    // sign-in button that will not work.
    ...("error" in authenticated && { error: authenticated.error }),
    ...(authenticated.kind === "session" && { config: clientConfig }),
  };
}

export async function handle(
  request: Request,
  getEnv: EnvReader,
  getBinding: BindingReader,
): Promise<Response> {
  const url = new URL(request.url);
  // The same split the cookie scope uses, so a site base that itself contains
  // the API segment cannot be read one way here and another way there.
  const path = url.pathname
    .slice(sitePath(url).length + API_BASE.length)
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
    const denied = tooMany("Too many sign-in attempts. Wait a moment and try again.");

    return limited(signInTotal, "all", denied, () =>
      limited(signIn, callerAddress(request), denied, () =>
        path === "/login" ? startLogin(url, getEnv) : completeLogin(request, url, getEnv),
      ),
    );
  }

  const provider = providerConfig();
  const authenticated = await authenticate(request, url, getEnv, provider);
  const renewed = authenticated.kind === "session" ? authenticated.cookie : undefined;
  const extra: Record<string, string> = renewed ? { "set-cookie": renewed } : {};

  // Answered for anyone, signed in or not: it is the question the shell asks to
  // find out which it is.
  if (path === "/session" && request.method === "GET") {
    return json(sessionState(request, url, authenticated), 200, extra);
  }

  // A POST, so the same-origin check above covers it: as a GET, any third-party
  // page could sign an editor out with a top-level navigation, which carries the
  // `SameSite=Lax` cookie.
  //
  // Ahead of the refusals below, so signing out is the one thing that still
  // works for a session the CMS has otherwise stopped honouring.
  if (path === "/logout" && request.method === "POST") {
    // The token as well as the cookie, so the grant ends here rather than
    // whenever it would have lapsed. `local` has no provider and no token.
    if (provider && "session" in authenticated) {
      await revokeSession(provider, getEnv, authenticated.session);
    }

    return json({ ok: true }, 200, { "set-cookie": sessionCookie(url) });
  }

  if (authenticated.kind === "revoked") return fail(authenticated.error, 403);

  // A misconfigured deployment reads as unsigned here; it says why to the shell's
  // probe, not to whoever sent a cookie.
  if (authenticated.kind !== "session") return fail("Not signed in.", 401);

  const { session } = authenticated;
  const ctx = createContext(session, getEnv, getBinding);

  if (path === "/rpc" && request.method === "POST") {
    const body = await readBody(request, MAX_RPC_BYTES);

    let call: { op?: unknown; input?: unknown };
    try {
      call = JSON.parse(body) as typeof call;
    } catch {
      // A body this server could not parse is a malformed request, not a failure
      // of its own, and saying so keeps the parser's message out of the answer.
      return fail("Malformed request body.", 400);
    }

    const { op, input } = call;

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
        // These bytes are served same-origin with the admin's own cookie, so a
        // type a browser would run as a document is stored XSS waiting for an
        // editor to open it. An object store is told the same thing at upload
        // (see `UploadTerms.attachment`); bytes proxied from a repository have
        // no such record, so the decision is remade from the type here.
        ...(isActiveContentType(content.contentType) && {
          "content-disposition": "attachment",
        }),
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

    const response = await relay({
      request,
      getEnv,
      ai,
      models: clientConfig.ai?.models ?? [],
      caller: session.login,
      fail,
    });

    // A long streaming answer is exactly when a token lapses mid-request, so the
    // renewal cannot be the one response that drops it.
    for (const [name, value] of Object.entries(extra)) response.headers.set(name, value);

    return response;
  }

  if (path === "/upload" && request.method === "PUT") {
    const params = url.searchParams;
    const uploadPath = params.get("path");

    if (!uploadPath) return fail("An upload path is required.", 400);

    const bytes = await readBytes(request, MAX_PROXY_UPLOAD_BYTES);

    await (await ctx.media()).uploadMedia(uploadPath, bytes, params.get("overwrite") === "true");

    return json({ ok: true }, 200, extra);
  }

  return fail("Not found.", 404);
}

async function startLogin(url: URL, getEnv: EnvReader): Promise<Response> {
  const provider = providerConfig();

  if (!provider) return fail("This deployment does not sign in.", 400);

  const verifier = createVerifier();
  const redirectUri = siteUrl(url, API_CALLBACK);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizationUrl(provider, redirectUri, await challengeFor(verifier)),
      // The verifier lives in its own short-lived sealed cookie rather than in
      // `sessionStorage`, so script in the admin can neither read it nor plant one.
      "set-cookie": loginCookie(
        url,
        await issue(
          "oauth-login",
          { verifier } satisfies Login,
          sessionSecret(provider, getEnv),
          LOGIN_MAX_AGE,
        ),
      ),
      "cache-control": "no-store",
    },
  });
}

async function completeLogin(request: Request, url: URL, getEnv: EnvReader): Promise<Response> {
  const provider = providerConfig();

  if (!provider) return fail("This deployment does not sign in.", 400);

  const admin = siteUrl(url, clientConfig.mountPoint);

  // However this ends, the verifier is spent: every answer tears up the cookie
  // carrying it, so one code can be redeemed against it and no more.
  const redirect = (location: string, session?: string): Response => {
    const headers = new Headers({ location, "cache-control": "no-store" });

    headers.append("set-cookie", loginCookie(url));

    if (session) headers.append("set-cookie", session);

    return new Response(null, { status: 302, headers });
  };

  const failed = (message: string) => redirect(`${admin}?error=${encodeURIComponent(message)}`);

  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) return failed(error);

  const secret = sessionSecret(provider, getEnv);
  const cookie = readCookie(request, LOGIN_COOKIE);
  const login = cookie ? await verify<Login>("oauth-login", cookie, secret) : null;
  const code = url.searchParams.get("code");

  // The callback has to belong to the sign-in this browser started, and the
  // challenge is what says so. Checked here rather than left to the provider's
  // own verifier check, so a forged callback costs a hash instead of an outbound
  // request against the budget that bounds them.
  if (!code || !login || url.searchParams.get("state") !== (await challengeFor(login.verifier))) {
    return failed("The sign-in link expired. Try again.");
  }

  const session = await exchangeCode(
    provider,
    getEnv,
    code,
    siteUrl(url, API_CALLBACK),
    login.verifier,
  );

  return redirect(admin, sessionCookie(url, await issueSession(session, secret)));
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
