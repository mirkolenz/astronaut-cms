import rawConfig from "virtual:astronaut-cms/config";

/** AI assistant settings, or undefined when the assistant is disabled. */
export const aiConfig = rawConfig.ai;

export const aiEnabled = aiConfig != null;
