import {
  ToolLoopAgent,
  isStepCount,
  type InferAgentUIMessage,
  type InferUITools,
  type ToolUIPart,
} from "ai";
import { queryClient } from "@client/lib/query-client";
import { useAiSettingsStore } from "@client/stores/ai-settings-store";
import { aiConfig } from "./config";
import { aiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system-prompt";
import { cmsTools, readOnlyTools } from "./tools";

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
  stopWhen: isStepCount(aiConfig?.maxSteps ?? 24),
  prepareCall: (settings) => ({ ...settings, ...callSettings() }),
  // Tools write through the storage layer directly, bypassing the mutation hooks
  // in `queries/` that normally invalidate. Doing it here rather than per tool
  // keeps new tools covered automatically, while skipping the reads keeps a long
  // agent run from refetching every mounted query on each step.
  onToolExecutionEnd: ({ toolCall }) => {
    if (readOnlyTools.has(toolCall.toolName)) return;

    void queryClient.invalidateQueries({ queryKey: ["cms"] });
  },
});

/** Chat message type of this agent, with its tool inputs and outputs typed. */
export type CmsUIMessage = InferAgentUIMessage<typeof cmsAgent>;

/** A single tool call within a `CmsUIMessage`, narrowed to the CMS tool set. */
export type CmsToolUIPart = ToolUIPart<InferUITools<typeof cmsTools>>;
