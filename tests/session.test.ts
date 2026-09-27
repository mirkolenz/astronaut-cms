import { describe, expect, it } from "vitest";
import {
  cmsCookie,
  cookiePath,
  isSameOrigin,
  needsRefresh,
  readCookie,
  issue,
  verify,
  type Session,
} from "@server/session";
import { signInPage } from "@server/sign-in-page";

// The session cookie is now the only thing standing between a visitor and the
// repository, so these pin the three properties it has to have: it cannot be
// read, it cannot be forged, and it cannot be used by another site.

const session: Session = {
  provider: "github",
  token: "ghu_secret",
  login: "alice",
  expiresAt: Date.now() + 3_600_000,
};

const SECRET = "a-long-deployment-secret";
const HOUR = 3600;

describe("sealed session", () => {
  it("round-trips through the cookie value", async () => {
    const token = await issue("session", session, SECRET, HOUR);

    expect(token).not.toContain("ghu_secret");
    await expect(verify<Session>("session", token, SECRET)).resolves.toMatchObject(session);
  });

  // Tampered, truncated, and issued-under-a-rotated-secret all have to read the
  // same way: nothing there. Anything else is a way to probe the key.
  it("refuses a token it did not issue", async () => {
    const token = await issue("session", session, "first-secret", HOUR);

    await expect(verify("session", token, "second-secret")).resolves.toBeNull();
    await expect(verify("session", `${token}x`, "first-secret")).resolves.toBeNull();
    await expect(verify("session", "not-a-cookie", "first-secret")).resolves.toBeNull();
  });

  // Every kind of token the CMS issues shares one key, so without the audience a
  // session would verify as an OAuth state — and, once MCP lands, an
  // authorization code as an access token.
  it("refuses a token issued for another purpose", async () => {
    const state = await issue("oauth-state", { state: "abc" }, SECRET, HOUR);

    await expect(verify("session", state, SECRET)).resolves.toBeNull();
    await expect(verify("oauth-state", state, SECRET)).resolves.toMatchObject({ state: "abc" });
  });

  // The cookie's Max-Age is the browser's to honour; this is the server's own
  // ceiling, so a copied value stops working whatever the browser was told.
  it("refuses a token past its expiry", async () => {
    const expired = await issue("session", session, SECRET, -1);

    await expect(verify("session", expired, SECRET)).resolves.toBeNull();
  });

  // The key is derived from the secret and nothing else, so every instance of a
  // deployment reaches the same one and a cookie survives a cold start. Issuing
  // under a different secret in between evicts the derivation cache, which is
  // what makes this a test of the derivation rather than of the cache.
  it("derives the same key wherever it runs", async () => {
    const token = await issue("session", session, "shared-deployment-secret", HOUR);

    await issue("session", session, "some-other-secret", HOUR);

    await expect(verify<Session>("session", token, "shared-deployment-secret")).resolves.toMatchObject(
      session,
    );
  });

  it("renews a token before it lapses, not after", () => {
    expect(needsRefresh({ ...session, expiresAt: Date.now() + 3_600_000 })).toBe(false);
    expect(needsRefresh({ ...session, expiresAt: Date.now() + 1_000 })).toBe(true);
    expect(needsRefresh({ ...session, expiresAt: undefined })).toBe(false);
  });
});

describe("cookie scope", () => {
  it("is confined to the CMS API, under a site base too", () => {
    expect(cookiePath(new URL("https://x.test/_astronaut-cms/api/rpc"), "/_astronaut-cms/api")).toBe(
      "/_astronaut-cms/api",
    );
    expect(
      cookiePath(new URL("https://x.test/docs/_astronaut-cms/api/rpc"), "/_astronaut-cms/api"),
    ).toBe("/docs/_astronaut-cms/api");
  });

  it("is HttpOnly and Lax, and Secure only where that is not self-defeating", () => {
    const attributes = cmsCookie({
      name: "s",
      url: new URL("https://x.test/_astronaut-cms/api/rpc"),
      apiBase: "/_astronaut-cms/api",
      value: "v",
    });

    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Secure");
    // A plain-http dev server would drop a Secure cookie outright.
    expect(
      cmsCookie({
        name: "s",
        url: new URL("http://localhost:4321/_astronaut-cms/api/rpc"),
        apiBase: "/_astronaut-cms/api",
        value: "v",
      }),
    ).not.toContain("Secure");
  });

  it("expires the cookie when there is no value to set", () => {
    expect(
      cmsCookie({
        name: "s",
        url: new URL("https://x.test/_astronaut-cms/api/logout"),
        apiBase: "/_astronaut-cms/api",
      }),
    ).toContain("Max-Age=0");
  });

  it("reads one cookie out of many", () => {
    const request = new Request("https://x.test/", {
      headers: { cookie: "other=1; astronaut_cms_session=abc.def; another=2" },
    });

    expect(readCookie(request, "astronaut_cms_session")).toBe("abc.def");
    expect(readCookie(request, "absent")).toBeUndefined();
  });
});

// Cookie auth is ambient: the browser attaches it to any request to this origin,
// whoever caused it. This is the check that a third-party page did not.
describe("same-origin gate", () => {
  const url = new URL("https://x.test/_astronaut-cms/api/rpc");
  const withHeaders = (headers: Record<string, string>) =>
    isSameOrigin(new Request(url, { method: "POST", headers }), url);

  it("accepts the admin's own request", () => {
    expect(withHeaders({ "sec-fetch-site": "same-origin" })).toBe(true);
    expect(withHeaders({ origin: "https://x.test" })).toBe(true);
  });

  it("refuses one another site caused", () => {
    expect(withHeaders({ "sec-fetch-site": "cross-site" })).toBe(false);
    expect(withHeaders({ origin: "https://evil.test" })).toBe(false);
    // A direct navigation is never a mutating CMS request.
    expect(withHeaders({ "sec-fetch-site": "none" })).toBe(false);
  });
});

// The admin page is the largest unauthenticated surface the CMS has. This is
// what an anonymous request gets instead of it.
describe("sign-in page", () => {
  const page = async (state: Partial<Parameters<typeof signInPage>[0]> = {}) =>
    (
      await signInPage(
        { signedIn: false, loginUrl: "https://x.test/api/login", autoLogin: false, ...state },
        "en",
      ).text()
    ).toString();

  it("ships no bundle, no stylesheet and no config", async () => {
    const html = await page();

    expect(html).not.toContain("<script");
    expect(html).not.toContain("astronaut-cms/client");
    expect(html).toContain('href="https://x.test/api/login"');
  });

  // Nothing on it needs script, so nothing on it is allowed to have any.
  it("allows nothing in its own policy", () => {
    const headers = signInPage(
      { signedIn: false, loginUrl: "/login", autoLogin: false },
      "en",
    ).headers;

    expect(headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(headers.get("content-security-policy")).not.toContain("script-src 'self'");
    expect(headers.get("cache-control")).toBe("private, no-store");
  });

  // `error` is whatever the provider put on the callback URL, so it arrives
  // through the query string and is the one attacker-influenced value here.
  it("escapes the provider's message", async () => {
    const html = await page({ error: '<img src=x onerror="alert(1)">' });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
