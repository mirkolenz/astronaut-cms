import * as client from "openid-client";
import { AUTH_TOKEN_PATTERN, GITHUB_TOKEN_ENDPOINT } from "@shared/auth";
import { siteUrl } from "@client/lib/site-url";
import { siteFetch } from "@client/lib/site-fetch";
import { scopeParam } from "./redirect-flow";

const AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
const DEVICE_AUTHORIZATION_ENDPOINT = "https://github.com/login/device/code";

function buildConfiguration(clientId: string, tokenEndpoint: string): client.Configuration {
  return new client.Configuration(
    {
      issuer: "https://github.com",
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
      token_endpoint: tokenEndpoint,
      device_authorization_endpoint: DEVICE_AUTHORIZATION_ENDPOINT,
    },
    clientId,
    undefined,
    client.None(),
  );
}

/**
 * The device flow redeems its code at GitHub without a client secret. The
 * redirect flow cannot, so it redeems at the CMS's own relay instead (see
 * `src/auth/handler.ts`), which adds the secret server-side.
 */
export function getGitHubRedirectConfiguration(clientId: string): client.Configuration {
  const tokenEndpoint = siteUrl(AUTH_TOKEN_PATTERN);
  const config = buildConfiguration(clientId, tokenEndpoint);

  // The relay is same-origin, so an access proxy in front of the site can
  // intercept the exchange; `siteFetch` surfaces that as itself rather than as
  // an unexplained transport error. (The cast bridges a types-only gap:
  // openid-client's request body admits `Uint8Array<ArrayBufferLike>`, which
  // lib.dom's `BodyInit` no longer models since typed arrays became generic.)
  config[client.customFetch] = (url, options) => siteFetch(url, options as RequestInit);

  // The relay is plain http under `astro dev`, which openid-client otherwise
  // refuses to talk to.
  if (new URL(tokenEndpoint).protocol !== "https:") client.allowInsecureRequests(config);

  return config;
}

export interface DeviceAuthorizationResult {
  userCode: string;
  verificationUri: string;
  poll: (signal?: AbortSignal) => Promise<client.TokenEndpointResponse>;
}

export async function initiateDeviceAuthorization(
  clientId: string,
  scopes: string[],
): Promise<DeviceAuthorizationResult> {
  const config = buildConfiguration(clientId, GITHUB_TOKEN_ENDPOINT);
  const handle = await client.initiateDeviceAuthorization(config, scopeParam(scopes));

  return {
    userCode: handle.user_code,
    verificationUri: handle.verification_uri,
    poll(signal?: AbortSignal): Promise<client.TokenEndpointResponse> {
      return client.pollDeviceAuthorizationGrant(config, handle, undefined, { signal });
    },
  };
}
