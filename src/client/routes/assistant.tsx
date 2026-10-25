import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { ChatComposer } from "@/client/components/ai/chat-composer";
import { ChatError, ChatMessages } from "@/client/components/ai/chat-view";
import { useCmsChat } from "@/client/hooks/use-cms-chat";
import { AiKeyGate, AiKeyReset } from "@/client/components/ai/key-gate";
import { aiConfig } from "@/client/lib/ai/config";
import { useAiKeyStore } from "@/client/stores/ai-key-store";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
});

// A full-screen chat surface, reached from the sidebar menu. The conversation
// itself lives in the shared Chat behind useCmsChat(), so leaving and returning
// to this route resumes it. A centered column keeps lines readable on wide
// screens.
function AssistantPage() {
  const chat = useCmsChat();
  const key = useAiKeyStore((state) => state.key);

  // The menu only links here when the assistant is enabled; guard anyway.
  if (!aiConfig) return null;

  const column = "mx-auto w-full max-w-3xl";

  // Nothing can be asked before there is a credential to ask with, and in this
  // mode the credential is the editor's to give.
  if (aiConfig.byok && !key) {
    return (
      <div className="flex min-h-0 flex-1 items-center">
        <AiKeyGate className={cn(column, "p-4")} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMessages chat={chat} className={column} />
      <ChatError chat={chat} className={cn(column, "mt-2")} />
      <ChatComposer chat={chat} className={cn(column, "mt-2 shrink-0")} />
      {aiConfig.byok && (
        <div className={cn(column, "flex justify-end")}>
          <AiKeyReset />
        </div>
      )}
    </div>
  );
}
