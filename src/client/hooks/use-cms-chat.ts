import { useChat } from "@ai-sdk/react";
import { getChat } from "@/client/lib/ai/chat";

/**
 * Subscribes to the shared Chat, so every view that renders it stays in sync.
 * Unthrottled, the hook re-renders the whole transcript on every streamed token;
 * 50ms is the interval the AI SDK documents for this.
 */
export function useCmsChat() {
  return useChat({ chat: getChat(), throttle: 50 });
}

export type CmsChat = ReturnType<typeof useCmsChat>;
