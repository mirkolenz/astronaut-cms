import { describe, expect, it } from "vitest";
import {
  authorizationUrl,
  challengeFor,
  createVerifier,
  type ProviderConfig,
} from "@/server/oauth";

// PKCE is what binds an authorization code to the browser that asked for it, and
// the challenge doubles as `state` so a forged callback is refused before any
// code is spent. These pin both halves of that.

const github: ProviderConfig = {
  provider: "github",
  clientId: "Iv1.abc",
  target: "owner/repo",
  scopes: [],
};

describe("PKCE", () => {
  // RFC 7636 appendix B. Both providers accept S256 and nothing else, so an
  // encoding mistake here is a sign-in that fails only in production.
  it("derives the challenge the way the RFC does", async () => {
    await expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("mints an unpadded 43-character verifier", () => {
    const verifier = createVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(verifier).not.toBe(createVerifier());
  });

  it("sends the challenge as both the challenge and the state", async () => {
    const verifier = createVerifier();
    const challenge = await challengeFor(verifier);
    const { searchParams } = new URL(
      authorizationUrl(github, "https://x.test/callback", challenge),
    );

    expect(searchParams.get("code_challenge")).toBe(challenge);
    expect(searchParams.get("code_challenge_method")).toBe("S256");
    expect(searchParams.get("state")).toBe(challenge);
    // A GitHub App derives its permissions from the installation, so `scope=` is
    // not the same request as no scope.
    expect(searchParams.has("scope")).toBe(false);
  });
});
