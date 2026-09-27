import * as client from "openid-client";

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
