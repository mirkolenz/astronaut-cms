// Reasoning effort levels, named after the AI SDK's portable reasoning values
// and forwarded to the model as the OpenAI-compatible `reasoning_effort` request
// field. "provider-default" omits the field so the model keeps its own behavior
// (and non-reasoning models are unaffected), while "none" asks the model to
// answer without a thinking phase.
export const REASONING_EFFORTS = ["provider-default", "none", "low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
