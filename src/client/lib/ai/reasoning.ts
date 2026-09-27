// Reasoning effort levels forwarded to the model as the OpenAI-compatible
// `reasoning_effort` request field. "off" omits the field entirely so the model
// keeps its default behavior (and non-reasoning models are unaffected).
export const REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
