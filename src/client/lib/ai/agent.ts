import {
  ToolLoopAgent,
  isStepCount,
  type InferAgentUIMessage,
  type InferUITools,
  type ToolUIPart,
} from "ai";
import { useAiPanelStore } from "@client/stores/ai-panel-store";
import { aiConfig } from "./config";
import { aiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system-prompt";
import { cmsTools, cmsToolApproval } from "./tools";

// Read from the panel store on every call (via `prepareCall`) so one agent
// outlives model and effort switches instead of being recreated. The effort goes
// through `providerOptions` rather than the portable top-level `reasoning`
// option because the OpenAI-compatible provider drops "none" instead of
// forwarding it, which would leave reasoning on when the user turned it off.
function callSettings() {
  const { model, effort } = useAiPanelStore.getState();

  return {
    model: aiProvider.chatModel(model),
    providerOptions:
      effort === "provider-default"
        ? undefined
        : { openaiCompatible: { reasoningEffort: effort } },
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
  toolApproval: cmsToolApproval,
  stopWhen: isStepCount(aiConfig?.maxSteps ?? 24),
  prepareCall: (settings) => ({ ...settings, ...callSettings() }),
});

/** Chat message type of this agent, with its tool inputs and outputs typed. */
export type CmsUIMessage = InferAgentUIMessage<typeof cmsAgent>;

/** A single tool call within a `CmsUIMessage`, narrowed to the CMS tool set. */
export type CmsToolUIPart = ToolUIPart<InferUITools<typeof cmsTools>>;
