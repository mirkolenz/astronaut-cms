/**
 * Root-relative path for the OAuth token-exchange relay. GitHub-only: it is the
 * one provider that requires a client secret to redeem an authorization code
 * even under PKCE, so its redirect login cannot finish in the browser. GitLab
 * redeems its own codes and never reaches this route. Astro prepends the site
 * `base`.
 */
const AUTH_API_BASE = "/_astronaut-cms/auth";

/** Injected-route pattern for the token-exchange endpoint. */
export const AUTH_TOKEN_PATTERN = `${AUTH_API_BASE}/token`;

/** Environment variable holding the GitHub client secret the relay redeems codes with. */
export const GITHUB_CLIENT_SECRET_ENV = "ASTRONAUT_CMS_GITHUB_CLIENT_SECRET";

/**
 * Where a GitHub authorization code is redeemed. The relay posts here with the
 * secret added; the device flow posts here straight from the browser, since it
 * needs no secret.
 */
export const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
