import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/auth/handler.ts";
import { GITHUB_CLIENT_SECRET_ENV } from "@shared/auth";

// The relay spends a client secret on the browser's behalf, so what it refuses
// matters as much as what it forwards. It also has to restate GitHub's
// non-standard "HTTP 200 with an error member" as an actual error response,
// which every OAuth client would otherwise read as a malformed success.

const CLIENT_ID = "Iv1.abc";
const getEnv = (name: string) => (name === GITHUB_CLIENT_SECRET_ENV ? "s3cret" : undefined);

function tokenRequest(params: Record<string, string>): Request {
  return new Request("https://example.com/_astronaut-cms/auth/token", {
    method: "POST",
    body: new URLSearchParams(params),
  });
}

const validParams = {
  grant_type: "authorization_code",
  client_id: CLIENT_ID,
  code: "the-code",
  code_verifier: "the-verifier",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub token relay", () => {
  it("refuses a request naming another client", async () => {
    const res = await handle(tokenRequest({ ...validParams, client_id: "other" }), getEnv, CLIENT_ID);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  it("refuses any grant but the code exchange", async () => {
    const res = await handle(
      tokenRequest({ ...validParams, grant_type: "refresh_token" }),
      getEnv,
      CLIENT_ID,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "unsupported_grant_type" });
  });

  it("reports a missing client secret rather than calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handle(tokenRequest(validParams), () => undefined, CLIENT_ID);

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the secret and returns the token", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = new URLSearchParams(init.body as URLSearchParams);
      expect(sent.get("client_secret")).toBe("s3cret");
      expect(sent.get("code_verifier")).toBe("the-verifier");

      return new Response(JSON.stringify({ access_token: "gho_x", token_type: "bearer" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await handle(tokenRequest(validParams), getEnv, CLIENT_ID);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ access_token: "gho_x" });
  });

  it("restates GitHub's HTTP 200 error as a 400", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "bad_verification_code", error_description: "The code expired." }),
    );

    const res = await handle(tokenRequest(validParams), getEnv, CLIENT_ID);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "bad_verification_code",
      error_description: "The code expired.",
    });
  });
});
