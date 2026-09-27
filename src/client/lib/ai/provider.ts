import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { siteUrl } from "@client/lib/site-url";
import { authedSiteFetch } from "@client/lib/site-fetch";
import { AI_API_BASE } from "@shared/ai";

export const aiProvider = createOpenAICompatible({
  // The relay lives at the site base + AI_API_BASE and speaks the
  // OpenAI-compatible protocol, so the provider appends `/chat/completions`
  // itself. Absolute so the provider can parse it as a URL.
  baseURL: siteUrl(AI_API_BASE),
  name: "astronaut-cms",
  // Attaches the user's existing Git provider token, so the relay can verify
  // model access against the configured repository. No new secret is introduced.
  fetch: authedSiteFetch,
});
