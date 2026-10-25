// Reasoning effort levels, a subset of the AI SDK's portable reasoning values
// that OpenAI-compatible providers forward as the `reasoning_effort` request field.
export const REASONING_EFFORTS = ["low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
