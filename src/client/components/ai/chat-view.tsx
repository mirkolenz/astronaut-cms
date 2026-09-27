import { useChat } from "@ai-sdk/react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot } from "lucide-react";
import { isStaticToolUIPart } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@client/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@client/components/ai-elements/message";
import { ToolCall } from "@client/components/ai/tool-call";
import { Button } from "@client/components/ui/button";
import { getChat } from "@client/lib/ai/chat";
import { cn } from "@client/lib/utils";

/** Subscribes to the shared Chat, so every view that renders it stays in sync. */
export function useCmsChat() {
  return useChat({ chat: getChat() });
}

export type CmsChat = ReturnType<typeof useCmsChat>;

export function ChatMessages({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const { messages } = chat;

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className={className}>
        {messages.length === 0 ? (
          <ConversationEmptyState
            icon={<Bot className="size-6" />}
            title={t(($) => $.ai.emptyTitle)}
            description={t(($) => $.ai.emptyDescription)}
          />
        ) : (
          messages.map((m) => (
            <Message from={m.role} key={m.id}>
              <MessageContent>
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }

                  if (part.type === "file" && part.mediaType?.startsWith("image/")) {
                    return (
                      <img
                        key={i}
                        src={part.url}
                        alt={part.filename ?? ""}
                        className="max-h-64 w-fit rounded-md"
                      />
                    );
                  }

                  // Every CMS tool is statically defined, so no dynamic tool parts.
                  if (isStaticToolUIPart(part)) {
                    return <ToolCall key={i} part={part} />;
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
  );
}

export function ChatError({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const { error, regenerate } = chat;

  if (!error) return null;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        {t(($) => $.ai.errorTitle)}
      </div>
      {error.message && (
        <p className="mt-1 break-words text-xs text-muted-foreground">{error.message}</p>
      )}
      <Button variant="outline" size="sm" className="mt-2" onClick={() => void regenerate()}>
        {t(($) => $.ai.retry)}
      </Button>
    </div>
  );
}
