import * as client from "openid-client";

const serverMetadata: client.ServerMetadata = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
  device_authorization_endpoint: "https://github.com/login/device/code",
};

export interface DeviceAuthorizationResult {
  userCode: string;
  verificationUri: string;
  poll: (signal?: AbortSignal) => Promise<string>;
}

export async function initiateDeviceAuthorization(
  clientId: string,
): Promise<DeviceAuthorizationResult> {
  const config = new client.Configuration(serverMetadata, clientId, undefined, client.None());
  const handle = await client.initiateDeviceAuthorization(config, { scope: "repo" });

  return {
    userCode: handle.user_code,
    verificationUri: handle.verification_uri,
    async poll(signal?: AbortSignal): Promise<string> {
      const tokens = await client.pollDeviceAuthorizationGrant(config, handle, undefined, {
        signal,
      });
      return tokens.access_token;
    },
  };
}
