import * as client from "openid-client";
import { Octokit } from "@octokit/rest";

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

export function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid GitHub repo: ${repo}`);
  return { owner, repo: name };
}

export async function verifyRepoWriteAccess(token: string, repo: string): Promise<void> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.repos.get(parseRepo(repo));
  if (!data.permissions?.push) {
    throw new Error(`You need write access to ${repo} to use this CMS.`);
  }
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
