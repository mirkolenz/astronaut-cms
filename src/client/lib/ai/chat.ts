import { Chat } from "@ai-sdk/react";
import type { CmsUIMessage } from "@client/lib/ai/agent";
import { cmsTransport } from "@client/lib/ai/transport";

/** Starts a new conversation on the shared Chat. */
export function clearChat(): void {
  const chat = getChat();

  chat.messages = [];
  chat.clearError();
}

let instance: Chat<CmsUIMessage> | undefined;

// A single Chat shared across the app. The admin is a hash-routed SPA, so
// navigation never reloads the document and this module-level instance is what
// keeps the conversation alive while the assistant view is unmounted.
export function getChat(): Chat<CmsUIMessage> {
  instance ??= new Chat<CmsUIMessage>({ transport: cmsTransport });

  return instance;
}
