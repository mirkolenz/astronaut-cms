import type * as client from "openid-client";
import config from "virtual:astronaut-cms/config";
import type { AuthSession, Provider } from "@client/stores/auth-store";
import { siteUrl } from "@client/lib/site-url";
import { verifyGitHubWriteAccess, verifyGitLabWriteAccess } from "@shared/access";
import { toSession } from "./session";
import { startRedirectLogin, completeRedirectLogin } from "./redirect-flow";
import { getGitHubRedirectConfiguration, initiateDeviceAuthorization } from "./github";
import { getGitLabConfiguration } from "./gitlab";

export interface RedirectLogin {
  provider: Provider;
  /** Navigates to the provider's consent screen; never returns normally. */
  start: () => Promise<void>;
  /** Redeems the code the provider sent back, then verifies write access. */
  complete: (callbackUrl: URL) => Promise<AuthSession>;
}

type VerifyWriteAccess = (token: string) => Promise<void>;

/** A token is only ever turned into a session once write access is confirmed. */
async function toVerifiedSession(
  provider: Provider,
  tokens: client.TokenEndpointResponse,
  verifyWriteAccess: VerifyWriteAccess,
): Promise<AuthSession> {
  await verifyWriteAccess(tokens.access_token);

  return toSession(provider, tokens);
}

function makeLogin(
  provider: Provider,
  // Resolved on demand, not up front: GitLab's needs an OIDC discovery
  // round-trip, and an editor with a live session never signs in at all.
  getConfiguration: () => client.Configuration | Promise<client.Configuration>,
  scopes: string[],
  verifyWriteAccess: VerifyWriteAccess,
): RedirectLogin {
  // The provider returns the editor to the admin panel itself, which is also the
  // callback URL registered with the OAuth app.
  const redirectUri = siteUrl(config.mountPoint);

  return {
    provider,
    start: async () => startRedirectLogin(await getConfiguration(), redirectUri, scopes),
    complete: async (callbackUrl) => {
      const tokens = await completeRedirectLogin(await getConfiguration(), callbackUrl);

      return toVerifiedSession(provider, tokens, verifyWriteAccess);
    },
  };
}

/**
 * The configured backend's browser-redirect login, or null when it has none —
 * local storage, or GitHub left on the device flow. Both providers run the same
 * PKCE redirect, so collapsing them here keeps the sign-in UI free of any
 * per-provider branching beyond its label.
 */
export function getRedirectLogin(): RedirectLogin | null {
  if (config.gitlab) {
    const { clientId, instanceUrl, project, scopes } = config.gitlab;

    return makeLogin(
      "gitlab",
      () => getGitLabConfiguration(instanceUrl, clientId),
      scopes,
      (token) => verifyGitLabWriteAccess(token, project, instanceUrl),
    );
  }

  if (config.github?.flow === "redirect") {
    const { clientId, repo, scopes } = config.github;

    return makeLogin(
      "github",
      () => getGitHubRedirectConfiguration(clientId),
      scopes,
      (token) => verifyGitHubWriteAccess(token, repo),
    );
  }

  return null;
}

/** What the sign-in screen shows once GitHub has issued a code to type in. */
export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
  /** Waits for the editor to enter the code, then verifies write access. */
  complete: (signal?: AbortSignal) => Promise<AuthSession>;
}

export interface DeviceLogin {
  provider: Provider;
  start: () => Promise<DevicePrompt>;
}

/**
 * GitHub's device login, or null when the backend does not use it. Resolved from
 * the config here, like the redirect login, so the sign-in UI reads no provider
 * config of its own and neither flow leaks its provider into the component.
 */
export function getDeviceLogin(): DeviceLogin | null {
  const github = config.github;

  if (!github || github.flow === "redirect") return null;

  return {
    provider: "github",
    start: async () => {
      const { userCode, verificationUri, poll } = await initiateDeviceAuthorization(
        github.clientId,
        github.scopes,
      );

      return {
        userCode,
        verificationUri,
        complete: async (signal) =>
          toVerifiedSession("github", await poll(signal), (token) =>
            verifyGitHubWriteAccess(token, github.repo),
          ),
      };
    },
  };
}
