import { APICallError, DirectChatTransport } from "ai";
import { cmsAgent } from "@/client/lib/ai/agent";

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

  if (Error.isError(error) && error.message) return error.message;

  return "The assistant ran into an unexpected error.";
}

// Drives the browser-side agent in-process instead of posting to an API route,
// so no HTTP hop sits between the chat UI and the agent loop.
export const cmsTransport = new DirectChatTransport({
  agent: cmsAgent,
  // The complete error goes to the console for inspection; the UI only ever
  // receives the concise message returned here (the SDK otherwise masks all
  // failures to a generic "An error occurred.").
  onError: (error) => {
    console.error("[astronaut-cms] AI assistant request failed:", error);

    return toUserErrorMessage(error);
  },
});
