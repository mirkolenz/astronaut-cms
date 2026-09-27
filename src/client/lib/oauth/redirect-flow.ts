/**
 * The browser half of an OAuth 2.0 authorization-code redirect login with PKCE,
 * shared by both providers: only the {@link client.Configuration} differs, and
 * with it where the code is redeemed (GitLab's own token endpoint, or the CMS's
 * relay for GitHub, which has to add a client secret).
 */
import * as client from "openid-client";

const PKCE_SESSION_KEY = "astronaut-cms:pkce";

interface PkceState {
  codeVerifier: string;
  state: string;
}

function loadPkceState(): PkceState | null {
  try {
    const raw = sessionStorage.getItem(PKCE_SESSION_KEY);

    return raw ? (JSON.parse(raw) as PkceState) : null;
  } catch {
    return null;
  }
}

/**
 * The `scope` request parameter, omitted entirely when no scopes apply — a
 * GitHub App resolves to none, since it derives its permissions from the
 * installation, and `scope=""` is not the same request as no scope at all.
 */
export function scopeParam(scopes: string[]): Record<string, string> {
  return scopes.length ? { scope: scopes.join(" ") } : {};
}

export async function startRedirectLogin(
  config: client.Configuration,
  redirectUri: string,
  scopes: string[],
): Promise<void> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();

  sessionStorage.setItem(PKCE_SESSION_KEY, JSON.stringify({ codeVerifier, state }));

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...scopeParam(scopes),
  });

  window.location.href = authUrl.href;
}

/**
 * The callback the provider sent the browser back with, or null on an ordinary
 * page load. Taking it scrubs the spent parameters from the address bar, so a
 * reload cannot replay a code and a refused consent cannot re-render — knowing
 * what a callback URL looks like and that it is consumed exactly once belongs
 * to the flow, not to whatever renders the sign-in screen.
 */
export function takePendingCallback(): { url: URL; error: string | null } | null {
  const url = new URL(window.location.href);
  const error = url.searchParams.get("error");

  if (!error && !url.searchParams.get("code")) return null;

  window.history.replaceState({}, "", url.pathname + url.hash);

  return { url, error: error && (url.searchParams.get("error_description") ?? error) };
}

/** Redeems the authorization code carried by the callback URL. */
export async function completeRedirectLogin(
  config: client.Configuration,
  callbackUrl: URL,
): Promise<client.TokenEndpointResponse> {
  const pkceState = loadPkceState();

  if (!pkceState) throw new Error("No PKCE state found");

  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    expectedState: pkceState.state,
    pkceCodeVerifier: pkceState.codeVerifier,
    idTokenExpected: false,
  });

  sessionStorage.removeItem(PKCE_SESSION_KEY);

  return tokens;
}
