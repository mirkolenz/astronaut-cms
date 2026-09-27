import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tryGetToken } from "@client/lib/storage/utils";
import { AI_API_BASE } from "@shared/ai";

// The relay lives at the site base + AI_API_BASE and speaks the OpenAI-compatible
// protocol, so the provider appends `/chat/completions` itself. Absolute so the
// provider can parse it as a URL.
const baseURL = `${window.location.origin}${import.meta.env.BASE_URL}${AI_API_BASE.replace(/^\//, "")}`;

// Attach the user's existing Git provider token so the relay can verify model
// access against the configured repository. No new secret is introduced.
const authedFetch: typeof fetch = (input, init) => {
  const token = tryGetToken();
  const headers = new Headers(init?.headers);

  if (token) headers.set("authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
};

export const aiProvider = createOpenAICompatible({
  name: "astronaut-cms",
  baseURL,
  fetch: authedFetch,
});
