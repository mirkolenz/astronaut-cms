import { generateCodeVerifier, generateCodeChallenge } from "./pkce";
import config from "virtual:astronaut-cms/config";

const PKCE_SESSION_KEY = "astronaut-cms:gitlab-pkce";

interface PkceState {
  codeVerifier: string;
  state: string;
}

function getRedirectUri(): string {
  return `${window.location.origin}${config.mountPoint}`;
}

function savePkceState(state: PkceState) {
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

function clearPkceState() {
  sessionStorage.removeItem(PKCE_SESSION_KEY);
}

export async function startGitLabLogin(): Promise<void> {
  const gitlab = config.gitlab;
  if (!gitlab) throw new Error("GitLab config missing");

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  savePkceState({ codeVerifier, state });

  const params = new URLSearchParams({
    client_id: gitlab.clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    state,
    scope: "api",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${gitlab.instanceUrl}/oauth/authorize?${params.toString()}`;
}

export async function handleGitLabCallback(code: string, state: string): Promise<string> {
  const gitlab = config.gitlab;
  if (!gitlab) throw new Error("GitLab config missing");

  const pkceState = loadPkceState();
  if (!pkceState) throw new Error("No PKCE state found");
  if (pkceState.state !== state) throw new Error("State mismatch - possible CSRF");

  const res = await fetch(`${gitlab.instanceUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: gitlab.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
      code_verifier: pkceState.codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitLab token exchange failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token: string };
  clearPkceState();
  return data.access_token;
}
