/**
 * The sign-in dance, run entirely on the server. The browser never sees an
 * authorization code, a client secret or the resulting token: it is redirected
 * out, redirected back, and handed a sealed cookie.
 *
 * Both providers run the same authorization-code flow with PKCE, so only the
 * endpoints, the identity lookup and the write-access check differ. PKCE is not
 * here to stand in for a client secret — the CMS is a confidential client and
 * both providers still demand the secret at the exchange — but because it binds
 * a code to the browser that asked for it, which a confidential client gets no
 * other way. The verifier never leaves the server: it travels in a short-lived
 * sealed cookie rather than in `sessionStorage`, where script could read it or
 * plant one.
 *
 * That binding is also the whole of the callback's CSRF defence, which is why
 * there is no separate `state` secret to keep in step with it. `state` carries
 * the challenge, so a callback can be refused against the cookie before any
 * authorization code is spent; the verifier behind it is what makes the refusal
 * mean something.
 */
import { encode as base64url } from "jose/base64url";
import { z } from "zod";
import { GITHUB_CLIENT_SECRET_ENV, GITLAB_CLIENT_SECRET_ENV } from "../shared/auth.ts";
import type { Provider } from "../shared/auth.ts";
import { parseRepo } from "../shared/repo.ts";
import { joinUrl } from "../shared/url.ts";
import { getSecret } from "astro:env/server";
import type { Session } from "./session.ts";
import { GITHUB_API, githubClient } from "./storage/github.ts";
import { gitlabClient } from "./storage/gitlab.ts";

/** GitLab access levels: 30 = Developer, the lowest that may push and open MRs. */
const MIN_GITLAB_ACCESS_LEVEL = 30;

/** Where a GitLab backend points when the deployment does not host its own. */
const GITLAB_CLOUD = "https://gitlab.com";

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

/** The GitLab instance this deployment talks to. */
const gitlabUrl = (config: ProviderConfig): string => config.instanceUrl ?? GITLAB_CLOUD;

function endpoints(config: ProviderConfig): Endpoints {
  if (config.provider === "github") {
    return {
      authorize: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      secretEnv: GITHUB_CLIENT_SECRET_ENV,
    };
  }

  return {
    authorize: joinUrl(gitlabUrl(config), "oauth/authorize"),
    token: joinUrl(gitlabUrl(config), "oauth/token"),
    secretEnv: GITLAB_CLIENT_SECRET_ENV,
  };
}

export class OAuthError extends Error {}

/**
 * The OAuth client secret, which is also what the session cookie's key is
 * derived from (see `sessionSecret`). Missing, it names itself rather than
 * failing somewhere downstream.
 */
export function clientSecret(config: ProviderConfig): string {
  const { secretEnv } = endpoints(config);
  const secret = getSecret(secretEnv);

  if (!secret) {
    throw new OAuthError(`Sign-in is not configured: set ${secretEnv} on the server.`);
  }

  return secret;
}

/**
 * A fresh PKCE verifier: 32 random bytes, which encode to the 43 characters both
 * providers accept, and the only secret the sign-in cookie carries.
 */
export function createVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * What a verifier proves. `S256` is the only method either provider implements,
 * so there is nothing to negotiate and nothing to read back off the callback.
 */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return base64url(new Uint8Array(digest));
}

/** Where the provider sends the editor to approve, for a given challenge. */
export function authorizationUrl(
  config: ProviderConfig,
  redirectUri: string,
  challenge: string,
): string {
  const url = new URL(endpoints(config).authorize);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // The challenge again, so the callback can be refused against the sign-in
  // cookie before an authorization code is spent at the provider.
  url.searchParams.set("state", challenge);

  // A GitHub App derives its permissions from the installation, so it has no
  // scopes at all and `scope=` is not the same request as no scope.
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));

  return url.href;
}

// GitHub answers a failed exchange with HTTP 200 and an `error` member, so the
// body decides rather than the status.
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.never().optional(),
});

const tokenErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

type TokenResponse = z.infer<typeof tokenSchema>;

async function postToken(
  config: ProviderConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(endpoints(config).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: clientSecret(config),
    }),
  });

  const body: unknown = await response.json().catch(() => ({}));
  const token = tokenSchema.safeParse(body);

  if (token.success) return token.data;

  const { error, error_description } = tokenErrorSchema.safeParse(body).data ?? {};

  throw new OAuthError(error_description ?? error ?? "Sign-in failed.");
}

function toSession(provider: OAuthProvider, token: TokenResponse, login: string): Session {
  return {
    provider,
    token: token.access_token,
    ...(token.refresh_token && { refreshToken: token.refresh_token }),
    ...(token.expires_in != null && { expiresAt: Date.now() + token.expires_in * 1000 }),
    login,
  };
}

/** Redeems the callback's code, then refuses an editor who cannot write to the target. */
export async function exchangeCode(
  config: ProviderConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<Session> {
  const token = await postToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  return toSession(config.provider, token, await verifyAccess(config, token.access_token));
}

/**
 * A lapsed token replaced in place, so an open tab never has to sign in again.
 * Write access is not re-checked here: the provider enforces it on every call
 * this token makes, which is a stronger check than asking it once.
 *
 * The refresh token is a parameter rather than something read off the session
 * because both providers rotate it: spending one invalidates it, so the caller
 * has to hold it to keep two requests from spending the same one (see
 * `refreshes` in `handler.ts`).
 */
export async function refreshSession(
  config: ProviderConfig,
  refreshToken: string,
  login: string,
): Promise<Session | null> {
  try {
    const token = await postToken(config, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    return toSession(config.provider, token, login);
  } catch {
    return null;
  }
}

/**
 * Ends the provider's side of the session, so signing out is not only local.
 *
 * Without it the cookie goes and the token lives on for the hours it has left,
 * which is the one window in which a session outlasts the editor's intent to end
 * it. Both providers revoke the grant rather than the one credential, so the
 * refresh token goes with it.
 *
 * Best effort by construction: the cookie is cleared whatever happens here, and
 * someone who asked to sign out is not the person to tell that the provider did
 * not answer.
 */
export async function revokeSession(
  config: ProviderConfig,
  session: Session,
): Promise<void> {
  try {
    const secret = clientSecret(config);

    if (config.provider === "github") {
      await fetch(`${GITHUB_API}/applications/${config.clientId}/token`, {
        method: "DELETE",
        headers: {
          // The app revoking its own grant, so it authenticates as the app.
          authorization: `Basic ${btoa(`${config.clientId}:${secret}`)}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          // Required by the API, which refuses a request without one.
          "user-agent": "astronaut-cms",
        },
        body: JSON.stringify({ access_token: session.token }),
      });

      return;
    }

    await fetch(joinUrl(gitlabUrl(config), "oauth/revoke"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: secret,
        token: session.token,
      }),
    });
  } catch {
    // Nothing to do about it, and nothing the editor could act on.
  }
}

/** A lookup whose failure means "not permitted" rather than "broken". */
const optional = <T>(lookup: Promise<T>): Promise<T | null> => lookup.catch(() => null);

/**
 * The editor's username, once it is established they may write to the target.
 *
 * At sign-in this turns "every write fails" into one clear message at the door.
 * It is also what a live session is re-checked against, for the reason given by
 * `revocable` in `handler.ts`.
 */
export async function verifyAccess(config: ProviderConfig, token: string): Promise<string> {
  return config.provider === "github"
    ? verifyGitHub(token, config.target)
    : verifyGitLab(token, config.target, gitlabUrl(config));
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
