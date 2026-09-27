import {
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
  convertToModelMessages,
  stepCountIs,
  streamText,
} from "ai";
import { aiConfig } from "./config";
import { aiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system-prompt";
import { cmsTools } from "./tools";

// Runs the whole agent loop in the browser: each turn streams from the model
// (through the relay) and executes tool calls locally against the storage
// backend. The relay only ever sees raw, stateless inference requests.
export class LocalAgentTransport implements ChatTransport<UIMessage> {
  private readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const result = streamText({
      model: aiProvider.chatModel(this.modelId),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(options.messages),
      tools: cmsTools,
      stopWhen: stepCountIs(aiConfig?.maxSteps ?? 24),
      abortSignal: options.abortSignal,
    });

    return result.toUIMessageStream();
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
