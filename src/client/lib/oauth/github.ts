interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "repo",
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub device code request failed: ${res.status}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000;

  while (true) {
    if (signal?.aborted) throw new Error("Authentication cancelled");

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub token request failed: ${res.status}`);
    }

    const data = (await res.json()) as TokenResponse | TokenErrorResponse;

    if ("access_token" in data) {
      return data.access_token;
    }

    if ("error" in data) {
      switch (data.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        case "expired_token":
          throw new Error("Device code expired. Please try again.");
        case "access_denied":
          throw new Error("Access denied by user.");
        default:
          throw new Error(data.error_description ?? `OAuth error: ${data.error}`);
      }
    }
  }
}
