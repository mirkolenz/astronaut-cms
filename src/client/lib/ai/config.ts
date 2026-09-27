import rawConfig from "@/client/lib/config";

/** AI assistant settings, or undefined when the assistant is disabled. */
export const aiConfig = rawConfig.ai;

export const aiEnabled = aiConfig != null;
