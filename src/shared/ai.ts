import { API_BASE } from "./auth.ts";

/**
 * The AI relay, as the browser addresses it. It sits under the CMS API so one
 * injected route covers everything and one session cookie authenticates it; the
 * browser talks to it as an OpenAI-compatible endpoint, so the provider appends
 * `/chat/completions` itself.
 */
export const AI_API_BASE = `${API_BASE}/ai`;

/** Default maximum model/tool round-trips per assistant turn. */
export const DEFAULT_AI_MAX_STEPS = 24;
