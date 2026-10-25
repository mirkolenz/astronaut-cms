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
 * sticky instance, and the cost is that the cookie itself cannot be torn up
 * before it expires. What it grants can be: see `revocable` in `handler.ts`.
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
import { z } from "zod";
import { PROVIDERS } from "../shared/auth.ts";

export const SESSION_COOKIE = "astronaut_cms_session";

/** Cookie lifetime. A session outlives a lapsed token, which is refreshed in place. */
export const SESSION_TTL = 30 * 24 * 60 * 60;

/** Renewed this long before the provider token lapses, so a request never races it. */
const REFRESH_MARGIN_MS = 60_000;

/** Hostnames as `URL` spells them, IPv6 in brackets. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Who issued the token, so one verifier can refuse a well-formed foreign one. */
const ISSUER = "astronaut-cms";

/**
 * What a token is *for*. Every kind the CMS issues shares one key, so without
 * this a session would verify as a sign-in cookie and (once MCP lands) an
 * authorization code would verify as an access token. Binding the audience
 * makes that structural rather than a matter of which fields each reader
 * happens to check.
 */
export type TokenAudience = "session" | "oauth-login";

export const sessionSchema = z.object({
  provider: z.enum(PROVIDERS),
  /** The provider API credential. The only thing here worth protecting. */
  token: z.string(),
  /** Present when the provider issues expiring tokens (a GitHub App always does). */
  refreshToken: z.string().optional(),
  /** Epoch milliseconds, absent when the token does not expire. */
  expiresAt: z.number().optional(),
  /** Provider username. Cached here so the draft branch costs no round trip. */
  login: z.string(),
  /**
   * When the editor's repository access was last confirmed, in epoch
   * milliseconds. Carried in the cookie rather than in instance memory so the
   * check is made once per editor per window across the whole deployment, not
   * once per warm instance — on a serverless host most requests land somewhere
   * cold, and the check is an outbound round trip on the critical path of every
   * one of them. See `revoked` in `handler.ts`.
   */
  checkedAt: z.number().optional(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * What the sign-in cookie carries. The verifier alone: the challenge derived
 * from it is what the provider echoes back as `state`, so there is no second
 * secret to mint, to carry, or to keep in step with it.
 */
export const loginSchema = z.object({ verifier: z.string() });

export type Login = z.infer<typeof loginSchema>;

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
 * with a rotated secret, issued for another audience, or not matching the schema
 * are all "nothing there", because telling them apart is a way to probe the key.
 */
export async function verify<T>(
  audience: TokenAudience,
  token: string,
  secret: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, await sealingKey(secret), {
      issuer: ISSUER,
      audience,
    });

    return schema.parse(payload);
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
 * The site's `base`, recovered from the request rather than configured.
 *
 * Astro prepends `base` to an injected route, so at runtime it appears only as
 * whatever precedes the mounted path being answered. The cookie's scope and the
 * sign-in link both hang off it, and both are built from an API request, which
 * is the one path guaranteed to carry it.
 */
export function basePath(pathname: string, mounted: string): string {
  const index = pathname.lastIndexOf(mounted);

  return index > 0 ? pathname.slice(0, index) : "";
}

interface CookieOptions {
  name: string;
  url: URL;
  /** Where the cookie applies; see {@link cmsCookie}. */
  path: string;
  /** Omitted to expire the cookie, which is what signing out is. */
  value?: string;
  maxAge?: number;
}

/**
 * A `Set-Cookie` for one of the CMS's own cookies. `SameSite=Lax` so it survives
 * the top-level redirect back from the provider but not a cross-site form post.
 *
 * `path` is the caller's to decide; both callers scope it to the CMS API, so the
 * cookie is never attached to a request for the site's own pages. That is only
 * possible because the admin page reads no session (see `astro/admin.astro`): a
 * page that had to would need the cookie scoped wide enough to reach it.
 */
export function cmsCookie({ name, url, path, value, maxAge }: CookieOptions): string {
  const attributes = [
    `${name}=${value ?? ""}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${value ? (maxAge ?? SESSION_TTL) : 0}`,
  ];

  // Decided by the host rather than the scheme, which a TLS-terminating proxy
  // may rewrite to http. Only loopback is exempt, since some browsers drop a
  // Secure cookie on a plain-http dev server, so a deployment without TLS fails
  // to sign in rather than sending the cookie in the clear.
  if (!LOOPBACK_HOSTS.has(url.hostname)) attributes.push("Secure");

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
