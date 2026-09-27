/**
 * Root-relative base path for the AI assistant relay. The browser talks to this
 * as an OpenAI-compatible endpoint; the relay (a stateless on-demand route)
 * verifies the caller's Git provider token and forwards to the configured AI
 * gateway with platform-injected credentials. Astro prepends the site `base`.
 */
export const AI_API_BASE = "/_astronaut-cms/ai";

/** Injected-route pattern for the relay's OpenAI-compatible chat-completions endpoint. */
export const AI_CHAT_COMPLETIONS_PATTERN = `${AI_API_BASE}/chat/completions`;

/** Default maximum model/tool round-trips per assistant turn. */
export const DEFAULT_AI_MAX_STEPS = 24;
