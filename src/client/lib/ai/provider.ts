import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import config from "virtual:astronaut-cms/config";
import { tryGetToken } from "@client/lib/storage/utils";
import { AI_API_BASE } from "@shared/ai";

// The relay lives at the site base + AI_API_BASE and speaks the OpenAI-compatible
// protocol, so the provider appends `/chat/completions` itself. Absolute so the
// provider can parse it as a URL.
const baseURL = `${window.location.origin}${import.meta.env.BASE_URL}${AI_API_BASE.replace(/^\//, "")}`;

// The provider appends `/chat/completions` with no trailing slash, but the host
// site's `trailingSlash` policy decides which form Astro routes; mismatched, the
// relay 404s. Rewrite the path to the form Astro will match ("ignore" matches both).
function conformTrailingSlash(rawUrl: string): string {
  if (config.trailingSlash === "ignore") return rawUrl;

  const url = new URL(rawUrl);
  url.pathname =
    config.trailingSlash === "always"
      ? url.pathname.replace(/\/?$/, "/")
      : url.pathname.replace(/\/+$/, "");

  return url.toString();
}

// Attach the user's existing Git provider token so the relay can verify model
// access against the configured repository. No new secret is introduced.
const authedFetch: typeof fetch = (input, init) => {
  const token = tryGetToken();
  const headers = new Headers(init?.headers);

  if (token) headers.set("authorization", `Bearer ${token}`);

  const url =
    typeof input === "string" || input instanceof URL
      ? conformTrailingSlash(input.toString())
      : input;

  return fetch(url, { ...init, headers });
};

export const aiProvider = createOpenAICompatible({
  name: "astronaut-cms",
  baseURL,
  fetch: authedFetch,
});
