/**
 * The editor's session, sealed into a cookie the browser cannot read.
 *
 * The provider token lives here and nowhere else: it is encrypted with a key the
 * deployment derives, handed back as an HttpOnly cookie, and only ever decrypted
 * inside a server route. That is the whole point of the architecture — script
 * running in the admin can act as the editor while the tab is open, but it has
 * nothing portable to steal.
 *
 * Stateless on purpose. A serverless deployment needs no KV, no database and no
 * sticky instance, and the cost is that a session cannot be revoked before it
 * expires. The token inside it is a GitHub App user-to-server token, which
 * expires on its own, so the window is hours rather than forever.
 *
 * The format is a JWE (`dir` + A256GCM) rather than a bare AES-GCM blob. Same
 * primitive, standard envelope — which buys the two things a hand-rolled seal
 * has to be talked into: an `exp` the *server* enforces, so a copied cookie
 * value stops working whatever the browser does with `Max-Age`, and an `aud`
 * that makes each kind of token structurally unusable as another. It is also
 * what MCP's authorization codes and access tokens will be issued as, so there
 * is one token mechanism rather than two.
 */
import { EncryptJWT } from "jose/jwt/encrypt";
import { jwtDecrypt } from "jose/jwt/decrypt";
import type { Provider } from "../shared/auth.ts";

export const SESSION_COOKIE = "astronaut_cms_session";

/** Cookie lifetime. A session outlives a lapsed token, which is refreshed in place. */
export const SESSION_TTL = 30 * 24 * 60 * 60;

/** Renewed this long before the provider token lapses, so a request never races it. */
const REFRESH_MARGIN_MS = 60_000;

/** Who issued the token, so one verifier can refuse a well-formed foreign one. */
const ISSUER = "astronaut-cms";

/**
 * What a token is *for*. Every kind the CMS issues shares one key, so without
 * this a session would verify as an OAuth state and (once MCP lands) an
 * authorization code would verify as an access token. Binding the audience
 * makes that structural rather than a matter of which fields each reader
 * happens to check.
 */
export type TokenAudience = "session" | "oauth-state";

/**
 * Declared as a type alias rather than an interface so it carries the implicit
 * index signature a JWT payload needs.
 */
export type Session = {
  provider: Provider;
  /** The provider API credential. The only thing here worth protecting. */
  token: string;
  /** Present when the provider issues expiring tokens (a GitHub App always does). */
  refreshToken?: string;
  /** Epoch milliseconds, absent when the token does not expire. */
  expiresAt?: number;
  /** Provider username. Cached here so the draft branch costs no round trip. */
  login: string;
};

/**
 * Separates this key from whatever else the same secret is used for. The secret
 * is normally the OAuth client secret, which the deployment already holds and
 * already spends at the provider; HKDF is what makes reusing it sound, since the
 * derived key reveals nothing about the input.
 */
const KEY_INFO = new TextEncoder().encode("astronaut-cms session v1");

// Deriving is a KDF call per request otherwise, and the secret is fixed for the
// life of the instance.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function sealingKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle
      .importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey(
          // No salt: there is one key per deployment and nothing to separate it
          // from, so `info` carries the whole of the domain separation.
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: KEY_INFO },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );

    cachedKey = { secret, key };
  }

  return cachedKey.key;
}

/** Encrypts a payload so the browser can carry it but never read it. */
export async function issue(
  audience: TokenAudience,
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(await sealingKey(secret));
}

/**
 * What a token carries, or null when it carries nothing this deployment issued
 * for this purpose. Every failure reads the same way — tampered, expired, sealed
 * with a rotated secret, or issued for another audience are all "nothing there",
 * because telling them apart is a way to probe the key.
 */
export async function verify<T>(
  audience: TokenAudience,
  token: string,
  secret: string,
): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, await sealingKey(secret), {
      issuer: ISSUER,
      audience,
    });

    return payload as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) return rest.join("=");
  }

  return undefined;
}

/**
 * Where the session cookie applies: the CMS's own API routes and nothing else,
 * so it is never attached to a request for the site's own pages. Astro prepends
 * the site `base` to an injected route, so the path is taken from the request
 * that is being answered rather than assumed to be root-relative.
 */
export function cookiePath(url: URL, apiBase: string): string {
  const index = url.pathname.indexOf(apiBase);

  return index <= 0 ? apiBase : `${url.pathname.slice(0, index)}${apiBase}`;
}

interface CookieOptions {
  name: string;
  url: URL;
  apiBase: string;
  /** Omitted to expire the cookie, which is what signing out is. */
  value?: string;
  maxAge?: number;
}

/**
 * A `Set-Cookie` for one of the CMS's own cookies. Scoped to the API path, so it
 * is never attached to a request for the site's own pages; `SameSite=Lax` so it
 * survives the top-level redirect back from the provider but not a cross-site
 * form post.
 */
export function cmsCookie({ name, url, apiBase, value, maxAge }: CookieOptions): string {
  const attributes = [
    `${name}=${value ?? ""}`,
    `Path=${cookiePath(url, apiBase)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${value ? (maxAge ?? SESSION_TTL) : 0}`,
  ];

  // A plain-http dev server would drop a Secure cookie outright.
  if (url.protocol === "https:") attributes.push("Secure");

  return attributes.join("; ");
}

/** Whether the provider token is close enough to lapsing to be renewed now. */
export function needsRefresh(session: Session): boolean {
  return session.expiresAt != null && session.expiresAt - REFRESH_MARGIN_MS <= Date.now();
}

/**
 * Refuses a request that a third-party page made on the editor's behalf.
 *
 * Cookie authentication is ambient: unlike the bearer token this replaced, the
 * browser attaches it to any request to this origin, whoever caused it.
 * `SameSite=Lax` already blocks a cross-site POST, and this is the explicit
 * check behind it — for the browsers and proxies that do not, and so the rule is
 * stated where it is enforced rather than assumed from a cookie attribute.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get("sec-fetch-site");

  // Sent by every current browser. `none` is a direct navigation, which no
  // mutating CMS request ever is.
  if (site) return site === "same-origin";

  const origin = request.headers.get("origin");

  return origin == null || origin === url.origin;
}
