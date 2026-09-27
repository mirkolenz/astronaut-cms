import {
  ToolLoopAgent,
  isStepCount,
  type InferAgentUIMessage,
  type InferUITools,
  type ToolUIPart,
} from "ai";
import { DEFAULT_AI_MAX_STEPS } from "@/shared/ai";
import { useAiSettingsStore } from "@/client/stores/ai-settings-store";
import { aiConfig } from "./config";
import { aiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system-prompt";
import { cmsTools } from "./tools";

// Read from the panel store on every call (via `prepareCall`) so one agent
// outlives model and effort switches instead of being recreated. The effort goes
// through `providerOptions` rather than the portable top-level `reasoning`
// option because the OpenAI-compatible provider drops "none" instead of
// forwarding it, which would leave reasoning on when the user turned it off.
function callSettings() {
  const { model, effort } = useAiSettingsStore.getState();

  return {
    model: aiProvider.chatModel(model),
    providerOptions:
      effort === "provider-default" ? undefined : { openaiCompatible: { reasoningEffort: effort } },
  };
}

// The whole agent loop runs in the browser: each step streams from the model
// (through the relay) and executes its tool calls locally against the storage
// backend, so the agent inherits exactly the user's permissions and the
// draft-branch + PR review flow. The relay only ever sees raw, stateless
// inference requests.
export const cmsAgent = new ToolLoopAgent({
  // Placeholder for a required setting: `prepareCall` supplies the real model on
  // every call, so this value is never used to run one.
  model: aiProvider.chatModel(aiConfig?.models[0] ?? ""),
  instructions: SYSTEM_PROMPT,
  tools: cmsTools,
  stopWhen: isStepCount(aiConfig?.maxSteps ?? DEFAULT_AI_MAX_STEPS),
  prepareCall: (settings) => ({ ...settings, ...callSettings() }),
});

/** Chat message type of this agent. */
export type CmsUIMessage = InferAgentUIMessage<typeof cmsAgent>;

/**
 * A single tool call within a `CmsUIMessage`. The catalog is projected into the
 * SDK's shape at runtime, so the tool set is erased here and the inputs arrive
 * as `unknown`; `tool-summary.ts` reads them by name, which is the only thing
 * the UI ever wanted from them.
 */
export type CmsToolUIPart = ToolUIPart<InferUITools<typeof cmsTools>>;
