import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses, safeValidateUIMessages } from "ai";
import { cmsAgent, type CmsUIMessage } from "@client/lib/ai/agent";
import { cmsTransport } from "@client/lib/ai/transport";

const STORAGE_KEY = "astronaut-cms:chat";

export function saveMessages(messages: CmsUIMessage[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota or serialization errors
  }
}

// Starts a new conversation on the shared Chat: the mirrored copy goes too, so a
// reload does not bring the old one back. Also the escape hatch when a stored
// conversation can no longer be sent (see `restoreMessages`).
export function clearChat(): void {
  const chat = getChat();

  chat.messages = [];
  chat.clearError();

  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore unavailable storage
  }
}

// The stored conversation is replayed to the model on the next turn, so it has to
// still match the current tool schemas. After a collection changes it may not, and
// the transport would then reject every send with no way to recover from the UI,
// so an unusable conversation is dropped in favour of a fresh chat.
async function restoreMessages(chat: Chat<CmsUIMessage>): Promise<void> {
  let stored: unknown;

  try {
    stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return; // corrupt or unavailable storage
  }

  const result = await safeValidateUIMessages<CmsUIMessage>({
    messages: stored,
    tools: cmsAgent.tools,
  });

  if (!result.success) {
    console.warn(
      "[astronaut-cms] Discarded a stored conversation that no longer matches the content model:",
      result.error,
    );

    return;
  }

  // The user may have started a new message while validation was pending.
  if (chat.messages.length === 0) chat.messages = result.data;
}

let instance: Chat<CmsUIMessage> | undefined;

// A single Chat shared across the app whose conversation is mirrored to
// sessionStorage. The Astro dev server triggers a full page reload whenever
// content changes (the CMS writes content on every save), which would otherwise
// wipe the in-memory conversation; seeding from storage restores it across the
// reload.
export function getChat(): Chat<CmsUIMessage> {
  if (instance) return instance;

  const chat = new Chat<CmsUIMessage>({
    transport: cmsTransport,
    // Once the user has approved or denied every pending tool call, resume the
    // run automatically so the agent loop continues without a manual resend.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  instance = chat;
  void restoreMessages(chat);

  return chat;
}
