import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";
import { useAiPanelStore } from "@client/stores/ai-panel-store";
import { LocalAgentTransport } from "@client/lib/ai/transport";

const STORAGE_KEY = "astronaut-cms:chat";

function loadMessages(): UIMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UIMessage[];
  } catch {
    // ignore corrupt or unavailable storage
  }

  return [];
}

export function saveMessages(messages: UIMessage[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota or serialization errors
  }
}

let instance: Chat<UIMessage> | undefined;

// A single Chat shared across the app whose conversation is mirrored to
// sessionStorage. The Astro dev server triggers a full page reload whenever
// content changes (the CMS writes content on every save), which would otherwise
// wipe the in-memory conversation; seeding from storage restores it across the
// reload. The transport reads the active model lazily so switching models keeps
// the same chat.
export function getChat(): Chat<UIMessage> {
  instance ??= new Chat({
    messages: loadMessages(),
    transport: new LocalAgentTransport(() => useAiPanelStore.getState().model),
    // Once the user has approved or denied every pending tool call, resume the
    // run automatically so the agent loop continues without a manual resend.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  return instance;
}
