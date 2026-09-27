import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { apiFetch, apiUrl } from "@client/lib/routes";
import { AI_API_BASE } from "@shared/ai";

export const aiProvider = createOpenAICompatible({
  // The relay lives at the site base + AI_API_BASE and speaks the
  // OpenAI-compatible protocol, so the provider appends `/chat/completions`
  // itself. Absolute so the provider can parse it as a URL.
  baseURL: apiUrl(AI_API_BASE),
  name: "astronaut-cms",
  // The session cookie rides along with a same-origin request, so the relay is
  // authenticated by the same thing every other CMS call is.
  fetch: apiFetch,
});
