/**
 * The sign-in dance, run entirely on the server. The browser never sees an
 * authorization code, a client secret or the resulting token: it is redirected
 * out, redirected back, and handed a sealed cookie.
 *
 * Both providers run the same authorization-code flow, so only the endpoints,
 * the identity lookup and the write-access check differ. PKCE is not used: the
 * CMS is now a confidential client with a registered redirect URI, and GitHub
 * has never implemented PKCE anyway. `state` is what binds the callback to the
 * browser that started it, and it travels in its own short-lived sealed cookie
 * rather than in `sessionStorage`, where script could read or replace it.
 */
import { GITHUB_CLIENT_SECRET_ENV, GITLAB_CLIENT_SECRET_ENV } from "../shared/auth.ts";
import type { Provider } from "../shared/auth.ts";
import { parseRepo } from "../shared/repo.ts";
import { joinUrl } from "../shared/url.ts";
import type { EnvReader } from "../shared/runtime-env.ts";
import type { Session } from "./session.ts";
import { githubClient } from "./storage/github.ts";
import { gitlabClient } from "./storage/gitlab.ts";

/** GitLab access levels: 30 = Developer, the lowest that may push and open MRs. */
const MIN_GITLAB_ACCESS_LEVEL = 30;

/** The providers that actually sign anyone in: everything but the dev-only local one. */
export type OAuthProvider = Exclude<Provider, "local">;

/** What a provider needs from the CMS config to run a login. */
export interface ProviderConfig {
  provider: OAuthProvider;
  clientId: string;
  /** `owner/repo` for GitHub, the project path for GitLab. */
  target: string;
  /** GitLab only. */
  instanceUrl?: string;
  scopes: string[];
}

interface Endpoints {
  authorize: string;
  token: string;
  secretEnv: string;
}

function endpoints(config: ProviderConfig): Endpoints {
  if (config.provider === "github") {
    return {
      authorize: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      secretEnv: GITHUB_CLIENT_SECRET_ENV,
    };
  }

  const instanceUrl = config.instanceUrl ?? "https://gitlab.com";

  return {
    authorize: joinUrl(instanceUrl, "oauth/authorize"),
    token: joinUrl(instanceUrl, "oauth/token"),
    secretEnv: GITLAB_CLIENT_SECRET_ENV,
  };
}

export class OAuthError extends Error {}

/**
 * The OAuth client secret, which is also what the session cookie's key is
 * derived from (see `sessionSecret`). Missing, it names itself rather than
 * failing somewhere downstream.
 */
export function clientSecret(config: ProviderConfig, getEnv: EnvReader): string {
  const { secretEnv } = endpoints(config);
  const secret = getEnv(secretEnv);

  if (!secret) {
    throw new OAuthError(`Sign-in is not configured: set ${secretEnv} on the server.`);
  }

  return secret;
}

/** Where the provider sends the editor to approve, for a given `state`. */
export function authorizationUrl(
  config: ProviderConfig,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(endpoints(config).authorize);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  // A GitHub App derives its permissions from the installation, so it has no
  // scopes at all and `scope=` is not the same request as no scope.
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));

  return url.href;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(
  config: ProviderConfig,
  getEnv: EnvReader,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(endpoints(config).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: clientSecret(config, getEnv),
    }),
  });

  // GitHub answers a failed exchange with HTTP 200 and an `error` member, so the
  // body decides rather than the status.
  const body = (await response.json().catch(() => ({}))) as TokenResponse;

  if (body.error || !body.access_token) {
    throw new OAuthError(body.error_description ?? body.error ?? "Sign-in failed.");
  }

  return body;
}

function toSession(provider: OAuthProvider, token: TokenResponse, login: string): Session {
  return {
    provider,
    token: token.access_token!,
    ...(token.refresh_token && { refreshToken: token.refresh_token }),
    ...(token.expires_in != null && { expiresAt: Date.now() + token.expires_in * 1000 }),
    login,
  };
}

/** Redeems the callback's code, then refuses an editor who cannot write to the target. */
export async function exchangeCode(
  config: ProviderConfig,
  getEnv: EnvReader,
  code: string,
  redirectUri: string,
): Promise<Session> {
  const token = await postToken(config, getEnv, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  return toSession(config.provider, token, await verifyAccess(config, token.access_token!));
}

/**
 * A lapsed token replaced in place, so an open tab never has to sign in again.
 * Write access is not re-checked here: the provider enforces it on every call
 * this token makes, which is a stronger check than asking it once.
 */
export async function refreshSession(
  config: ProviderConfig,
  getEnv: EnvReader,
  session: Session,
): Promise<Session | null> {
  if (!session.refreshToken) return null;

  try {
    const token = await postToken(config, getEnv, {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });

    return toSession(config.provider, token, session.login);
  } catch {
    return null;
  }
}

/** A lookup whose failure means "not permitted" rather than "broken". */
const optional = <T>(lookup: Promise<T>): Promise<T | null> => lookup.catch(() => null);

/**
 * The editor's username, once it is established they may write to the target.
 * Run once at sign-in rather than per request: the token itself carries the
 * permission, so every later call is checked by the provider for free. This only
 * turns "every write fails" into one clear message at the door.
 */
async function verifyAccess(config: ProviderConfig, token: string): Promise<string> {
  return config.provider === "github"
    ? verifyGitHub(token, config.target)
    : verifyGitLab(token, config.target, config.instanceUrl ?? "https://gitlab.com");
}

async function verifyGitHub(token: string, repo: string): Promise<string> {
  const { owner, repo: name } = parseRepo(repo);
  const api = githubClient(token);
  const [user, repository] = await Promise.all([
    optional(api.json<{ login: string }>({ path: "user" })),
    optional(api.json<{ permissions?: { push?: boolean } }>({ path: `repos/${owner}/${name}` })),
  ]);

  if (!repository?.permissions?.push || !user) {
    throw new OAuthError(`You need write access to ${repo} to use this CMS.`);
  }

  return user.login;
}

async function verifyGitLab(token: string, project: string, instanceUrl: string): Promise<string> {
  const api = gitlabClient(instanceUrl, token);
  const [user, repository] = await Promise.all([
    optional(api.json<{ username: string }>({ path: "user" })),
    optional(
      api.json<{
        permissions?: {
          project_access?: { access_level?: number } | null;
          group_access?: { access_level?: number } | null;
        };
      }>({ path: `projects/${encodeURIComponent(project)}` }),
    ),
  ]);

  const access = Math.max(
    repository?.permissions?.project_access?.access_level ?? 0,
    repository?.permissions?.group_access?.access_level ?? 0,
  );

  if (access < MIN_GITLAB_ACCESS_LEVEL || !user) {
    throw new OAuthError(`You need write access to ${project} to use this CMS.`);
  }

  return user.username;
}
