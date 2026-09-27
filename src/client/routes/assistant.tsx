import { useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Bot } from "lucide-react";
import type { ToolUIPart } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@client/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@client/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@client/components/ai-elements/prompt-input";
import { ToolCall } from "@client/components/ai/tool-call";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@client/components/ui/select";
import { Button } from "@client/components/ui/button";
import { useAiPanelStore } from "@client/stores/ai-panel-store";
import { aiConfig } from "@client/lib/ai/config";
import { getChat, saveMessages } from "@client/lib/ai/chat";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
});

// A full-screen chat surface, reached from the sidebar menu. It composes the
// same ai-elements primitives as the generated ChatPanel and shares one Chat
// instance via getChat(), so the conversation is the same wherever it is shown.
// A centered column keeps lines readable on wide screens.
function AssistantPage() {
  const { t } = useTranslation();
  const model = useAiPanelStore((state) => state.model);
  const setModel = useAiPanelStore((state) => state.setModel);

  const { messages, sendMessage, status, stop, error, regenerate, addToolApprovalResponse } =
    useChat({ chat: getChat() });

  useEffect(() => {
    if (status !== "streaming") saveMessages(messages);
  }, [messages, status]);

  // The menu only links here when the assistant is enabled; guard anyway.
  if (!aiConfig) return null;

  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text?.trim()) void sendMessage({ text: message.text });
  };

  const column = "mx-auto w-full max-w-3xl";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={column}>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-6" />}
              title={t($ => $.ai.emptyTitle)}
              description={t($ => $.ai.emptyDescription)}
            />
          ) : (
            messages.map((m) => (
              <Message from={m.role} key={m.id}>
                <MessageContent>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }

                    if (part.type.startsWith("tool-")) {
                      return (
                        <ToolCall
                          key={i}
                          part={part as ToolUIPart}
                          onApprovalResponse={addToolApprovalResponse}
                        />
                      );
                    }

                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div
          role="alert"
          className={`${column} mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2`}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {t($ => $.ai.errorTitle)}
          </div>
          {error.message && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{error.message}</p>
          )}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void regenerate()}>
            {t($ => $.ai.retry)}
          </Button>
        </div>
      )}

      <PromptInput onSubmit={handleSubmit} className={`${column} mt-2 shrink-0`}>
        <PromptInputBody>
          <PromptInputTextarea placeholder={t($ => $.ai.placeholder)} />
        </PromptInputBody>
        <PromptInputFooter>
          {aiConfig.models.length > 1 && (
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-7 w-auto min-w-0 gap-1 border-none text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aiConfig.models.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <PromptInputSubmit className="ml-auto" status={status} onStop={stop} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
