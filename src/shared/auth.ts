/**
 * Where the CMS server lives and what it needs from the environment. Shared so
 * the browser addresses exactly the routes the integration injects.
 */
import type { CmsClientConfig } from "../integration/types.ts";

/**
 * Who issued the session. `local` is `astro dev` against the working tree, which
 * has no provider and therefore no sign-in at all.
 */
export const PROVIDERS = ["github", "gitlab", "local"] as const;

export type Provider = (typeof PROVIDERS)[number];

/** The element the shell renders and the admin mounts into, carrying the site's routing. */
export const ADMIN_ROOT_ID = "astronaut-cms-root";

/** Root-relative base of the CMS API. Astro prepends the site `base`. */
export const API_BASE = "/_astronaut-cms/api";

/** Injected-route pattern covering every CMS API path (see `server/endpoint.ts`). */
export const API_PATTERN = `${API_BASE}/[...path]`;

/**
 * The API's paths. Everything except the session probe and the sign-in dance is
 * one operation on {@link API_RPC}, so the surface a compromised browser can
 * reach is the operation registry and nothing wider.
 */
export const API_SESSION = `${API_BASE}/session`;

export const API_LOGIN = `${API_BASE}/login`;
export const API_CALLBACK = `${API_BASE}/callback`;
export const API_LOGOUT = `${API_BASE}/logout`;
export const API_RPC = `${API_BASE}/rpc`;

/**
 * Operations one {@link API_RPC} request may carry. Part of the protocol rather
 * than either side's preference: the browser fills batches up to it and the
 * server refuses one over it, so a disagreement would turn a client convenience
 * into a refusal of calls that had nothing wrong with them.
 */
export const MAX_BATCH_OPS = 20;
/** Media bytes, addressed as `${API_MEDIA}/<library>/<library path>`. */
export const API_MEDIA = `${API_BASE}/media`;
/** Upload bytes, for a store the server cannot hand the browser a URL to. */
export const API_UPLOAD = `${API_BASE}/upload`;

/**
 * What {@link API_SESSION} answers: the one question the admin shell can ask
 * without a session. Declared here rather than beside the handler so the client
 * can name the shape without importing the server, whose module graph reaches
 * the deployment's credentials.
 *
 * `config` doubles as the answer to "am I signed in": it is present for a
 * recognised editor and absent for everyone else, so there is no second field to
 * keep in agreement with it.
 */
export interface SessionState {
  /** Where the sign-in link goes. */
  loginUrl: string;
  /** Whether the shell should start the redirect without waiting for a click. */
  autoLogin: boolean;
  /** Why nobody can sign in, or why this session stopped counting. */
  error?: string;
  /** Sent only to a recognised editor: it is an inventory of the deployment. */
  config?: CmsClientConfig;
}

/**
 * Optional. The session cookie's key is derived from the OAuth client secret by
 * default, which every deployment already holds, so nothing has to be generated
 * or seeded. Set this to key sessions off something else instead — to expire
 * them without touching the OAuth app, or to share one session across services.
 */
export const SESSION_SECRET_ENV = "ASTRONAUT_CMS_SESSION_SECRET";

/** The OAuth client secret of the configured GitHub App or GitLab application. */
export const GITHUB_CLIENT_SECRET_ENV = "ASTRONAUT_CMS_GITHUB_CLIENT_SECRET";
export const GITLAB_CLIENT_SECRET_ENV = "ASTRONAUT_CMS_GITLAB_CLIENT_SECRET";

/**
 * Set by Cloudflare Access on every request it lets through. Its presence means
 * the editor has already signed in to the identity provider in front of this
 * site, which is why the admin starts the provider redirect itself instead of
 * showing a sign-in button.
 *
 * Deliberately not verified: it is read as a hint about what to render, never as
 * a permission. Forging it buys nothing, because the redirect it triggers still
 * has to complete a real OAuth exchange.
 */
export const CF_ACCESS_HEADER = "cf-access-jwt-assertion";
