import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { apiFetch, apiUrl } from "@/client/lib/routes";
import { AI_API_BASE } from "@/shared/ai";
import { aiConfig } from "@/client/lib/ai/config";
import { useAiKeyStore } from "@/client/stores/ai-key-store";

/**
 * The editor's own key, attached per request rather than built into the
 * provider, so entering or replacing one takes effect without rebuilding it.
 *
 * A plain `fetch`: this request goes to the gateway, not to the CMS, so it must
 * not carry the session cookie and there is no access proxy in front of it to
 * detect.
 */
const byokFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  const { key } = useAiKeyStore.getState();

  if (key) headers.set("authorization", `Bearer ${key}`);

  return fetch(input, { ...init, headers });
};

/**
 * Where inference goes. Either the relay on this site — which holds the
 * deployment's credential and is authenticated by the same session cookie as
 * every other CMS call — or, when each editor brings their own key, the gateway
 * itself, with this deployment out of the path entirely.
 *
 * Both speak the OpenAI-compatible protocol, so the provider appends
 * `/chat/completions` itself. Absolute, so it can parse either as a URL.
 */
export const aiProvider = createOpenAICompatible({
  name: "astronaut-cms",
  ...(aiConfig?.byok
    ? { baseURL: aiConfig.byok.baseUrl, headers: aiConfig.byok.headers, fetch: byokFetch }
    : { baseURL: apiUrl(AI_API_BASE), fetch: apiFetch }),
});
