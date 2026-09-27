import * as client from "openid-client";

export { verifyGitLabWriteAccess as verifyProjectWriteAccess } from "@shared/access";

const PKCE_SESSION_KEY = "astronaut-cms:gitlab-pkce";

interface PkceState {
  codeVerifier: string;
  state: string;
}

function savePkceState(state: PkceState): void {
  sessionStorage.setItem(PKCE_SESSION_KEY, JSON.stringify(state));
}

function loadPkceState(): PkceState | null {
  try {
    const raw = sessionStorage.getItem(PKCE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PkceState;
  } catch {
    return null;
  }
}

function clearPkceState(): void {
  sessionStorage.removeItem(PKCE_SESSION_KEY);
}

// instanceUrl and clientId are fixed per app, so OIDC discovery (a network
// round-trip) only needs to run once; cache the result and retry on failure.
let configCache: Promise<client.Configuration> | null = null;

export function getGitLabConfiguration(
  instanceUrl: string,
  clientId: string,
): Promise<client.Configuration> {
  configCache ??= client
    .discovery(new URL(instanceUrl), clientId, undefined, client.None())
    .catch((err: unknown) => {
      configCache = null;
      throw err;
    });

  return configCache;
}

export async function startGitLabLogin(
  clientId: string,
  instanceUrl: string,
  redirectUri: string,
  scopes: string[],
): Promise<void> {
  const oidcConfig = await getGitLabConfiguration(instanceUrl, clientId);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();

  savePkceState({ codeVerifier, state });

  const authUrl = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.href = authUrl.href;
}

export async function handleGitLabCallback(
  clientId: string,
  instanceUrl: string,
  callbackUrl: URL,
): Promise<client.TokenEndpointResponse> {
  const pkceState = loadPkceState();
  if (!pkceState) throw new Error("No PKCE state found");

  const oidcConfig = await getGitLabConfiguration(instanceUrl, clientId);

  const tokens = await client.authorizationCodeGrant(oidcConfig, callbackUrl, {
    expectedState: pkceState.state,
    pkceCodeVerifier: pkceState.codeVerifier,
    idTokenExpected: false,
  });

  clearPkceState();
  return tokens;
}
