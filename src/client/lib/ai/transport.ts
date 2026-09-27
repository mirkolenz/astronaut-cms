import {
  APICallError,
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

// Maps a streaming failure to a concise line for the UI. The complete error is
// logged separately, so this only needs to be readable, not exhaustive.
function toUserErrorMessage(error: unknown): string {
  if (APICallError.isInstance(error)) {
    // The relay returns `{ error: { message } }`, which the provider surfaces
    // here; fall back to the status when the body carried no message.
    return error.message || `The AI service responded with status ${error.statusCode ?? "error"}.`;
  }

  // A failed fetch to the relay itself: server down, offline, or CORS.
  if (error instanceof TypeError) {
    return "Could not reach the assistant. Check that the server is running and try again.";
  }

  if (error instanceof Error && error.message) return error.message;

  return "The assistant ran into an unexpected error.";
}

// Runs the whole agent loop in the browser: each turn streams from the model
// (through the relay) and executes tool calls locally against the storage
// backend. The relay only ever sees raw, stateless inference requests.
export class LocalAgentTransport implements ChatTransport<UIMessage> {
  private readonly getModelId: () => string;

  // The model id is read lazily on each request so a single transport (and the
  // Chat that owns it) can outlive model switches instead of being recreated.
  constructor(getModelId: () => string) {
    this.getModelId = getModelId;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const result = streamText({
      model: aiProvider.chatModel(this.getModelId()),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(options.messages),
      tools: cmsTools,
      stopWhen: stepCountIs(aiConfig?.maxSteps ?? 24),
      abortSignal: options.abortSignal,
    });

    return result.toUIMessageStream({
      // The complete error goes to the console for inspection; the UI only ever
      // receives the concise message returned here (the SDK otherwise masks all
      // failures to a generic "An error occurred.").
      onError: (error) => {
        console.error("[astronaut-cms] AI assistant request failed:", error);

        return toUserErrorMessage(error);
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
