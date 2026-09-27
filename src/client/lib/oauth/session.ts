import * as client from "openid-client";
import config from "virtual:astronaut-cms/config";
import type { AuthSession, Provider } from "@client/stores/auth-store";
import { getGitLabConfiguration } from "./gitlab";

export function toSession(provider: Provider, tokens: client.TokenEndpointResponse): AuthSession {
  return {
    provider,
    accessToken: tokens.access_token,
    expiresAt: tokens.expires_in != null ? Date.now() + tokens.expires_in * 1000 : null,
  };
}

export function isExpired(session: AuthSession): boolean {
  return session.expiresAt != null && session.expiresAt <= Date.now();
}

export async function revokeSession(session: AuthSession): Promise<void> {
  // Only GitLab exposes token revocation to public (secret-less) clients;
  // GitHub tokens are left to expire or be revoked by uninstalling the app.
  if (session.provider !== "gitlab" || !config.gitlab) return;

  const oidcConfig = await getGitLabConfiguration(config.gitlab.instanceUrl, config.gitlab.clientId);
  await client.tokenRevocation(oidcConfig, session.accessToken);
}
