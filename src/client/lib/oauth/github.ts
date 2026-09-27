import * as client from "openid-client";

export { parseRepo, verifyGitHubWriteAccess as verifyRepoWriteAccess } from "@shared/access";

const serverMetadata: client.ServerMetadata = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
  device_authorization_endpoint: "https://github.com/login/device/code",
};

function getGitHubConfiguration(clientId: string): client.Configuration {
  return new client.Configuration(serverMetadata, clientId, undefined, client.None());
}

export interface DeviceAuthorizationResult {
  userCode: string;
  verificationUri: string;
  poll: (signal?: AbortSignal) => Promise<client.TokenEndpointResponse>;
}

export async function initiateDeviceAuthorization(
  clientId: string,
  scopes?: string[],
): Promise<DeviceAuthorizationResult> {
  const config = getGitHubConfiguration(clientId);

  // GitHub Apps derive permissions from the app installation and ignore the
  // scope parameter; OAuth Apps use it. Omit it entirely when no scopes apply.
  const params: Record<string, string> =
    scopes && scopes.length > 0 ? { scope: scopes.join(" ") } : {};
  const handle = await client.initiateDeviceAuthorization(config, params);

  return {
    userCode: handle.user_code,
    verificationUri: handle.verification_uri,
    poll(signal?: AbortSignal): Promise<client.TokenEndpointResponse> {
      return client.pollDeviceAuthorizationGrant(config, handle, undefined, { signal });
    },
  };
}
