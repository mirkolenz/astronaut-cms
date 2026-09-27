import { createFileRoute } from "@tanstack/react-router";
import { ChatComposer } from "@client/components/ai/chat-composer";
import { ChatError, ChatMessages, useCmsChat } from "@client/components/ai/chat-view";
import { aiConfig } from "@client/lib/ai/config";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
});

// A full-screen chat surface, reached from the sidebar menu. The conversation
// itself lives in the shared Chat behind useCmsChat(), so leaving and returning
// to this route resumes it. A centered column keeps lines readable on wide
// screens.
function AssistantPage() {
  const chat = useCmsChat();

  // The menu only links here when the assistant is enabled; guard anyway.
  if (!aiConfig) return null;

  const column = "mx-auto w-full max-w-3xl";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMessages chat={chat} className={column} />
      <ChatError chat={chat} className={`${column} mt-2`} />
      <ChatComposer chat={chat} className={`${column} mt-2 shrink-0`} />
    </div>
  );
}
