import * as client from "openid-client";
import { Gitlab } from "@gitbeaker/rest";

const PKCE_SESSION_KEY = "astronaut-cms:gitlab-pkce";

// GitLab access levels: 30 = Developer (can push to non-protected branches and open MRs).
const MIN_WRITE_ACCESS_LEVEL = 30;

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

async function getConfiguration(
  instanceUrl: string,
  clientId: string,
): Promise<client.Configuration> {
  return client.discovery(new URL(instanceUrl), clientId, undefined, client.None());
}

export async function startGitLabLogin(
  clientId: string,
  instanceUrl: string,
  redirectUri: string,
): Promise<void> {
  const oidcConfig = await getConfiguration(instanceUrl, clientId);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();

  savePkceState({ codeVerifier, state });

  const authUrl = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: redirectUri,
    scope: "api",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.href = authUrl.href;
}

export async function verifyProjectWriteAccess(
  token: string,
  project: string,
  instanceUrl: string,
): Promise<void> {
  const api = new Gitlab({ host: instanceUrl, oauthToken: token });
  const data = await api.Projects.show(project);
  const projectAccess = data.permissions?.project_access?.access_level ?? 0;
  const groupAccess = data.permissions?.group_access?.access_level ?? 0;
  if (Math.max(projectAccess, groupAccess) < MIN_WRITE_ACCESS_LEVEL) {
    throw new Error(`You need write access to ${project} to use this CMS.`);
  }
}

export async function handleGitLabCallback(
  clientId: string,
  instanceUrl: string,
  callbackUrl: URL,
): Promise<string> {
  const pkceState = loadPkceState();
  if (!pkceState) throw new Error("No PKCE state found");

  const oidcConfig = await getConfiguration(instanceUrl, clientId);

  const tokens = await client.authorizationCodeGrant(oidcConfig, callbackUrl, {
    expectedState: pkceState.state,
    pkceCodeVerifier: pkceState.codeVerifier,
    idTokenExpected: false,
  });

  clearPkceState();
  return tokens.access_token;
}
