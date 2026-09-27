import { useChat } from "@ai-sdk/react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot } from "lucide-react";
import { isStaticToolUIPart } from "ai";
import type { CmsUIMessage } from "@client/lib/ai/agent";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@client/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@client/components/ai-elements/message";
import { ReasoningTrace } from "@client/components/ai/reasoning-trace";
import { ToolCall } from "@client/components/ai/tool-call";
import { Button } from "@client/components/ui/button";
import { Spinner } from "@client/components/ui/spinner";
import { getChat } from "@client/lib/ai/chat";
import { cn } from "@client/lib/utils";

/**
 * Subscribes to the shared Chat, so every view that renders it stays in sync.
 * Unthrottled, the hook re-renders the whole transcript on every streamed token;
 * 50ms is the interval the AI SDK documents for this.
 */
export function useCmsChat() {
  return useChat({ chat: getChat(), throttle: 50 });
}

export type CmsChat = ReturnType<typeof useCmsChat>;

/**
 * One part of a message. The models speak the OpenAI-compatible protocol, which
 * never produces the part types left unrendered below (sources, custom provider
 * content), the CMS declares no data parts, and step boundaries carry no content
 * of their own. Hence the bare null.
 */
function MessagePart({ part }: { part: CmsUIMessage["parts"][number] }) {
  if (part.type === "text") return <MessageResponse>{part.text}</MessageResponse>;

  if (part.type === "reasoning") return <ReasoningTrace part={part} />;

  if (part.type === "file" && part.mediaType.startsWith("image/")) {
    return <img src={part.url} alt={part.filename ?? ""} className="max-h-64 w-fit rounded-md" />;
  }

  // Every CMS tool is statically defined, so no dynamic tool parts.
  if (isStaticToolUIPart(part)) return <ToolCall part={part} />;

  return null;
}

/**
 * Whether the agent is busy without looking busy. Only streaming text and
 * streaming reasoning draw themselves as they arrive; everything else is a
 * silent wait — the prefill before a step's first token, a tool's arguments
 * streaming into a collapsed card, the tool running, and the model being called
 * again with its result.
 */
function isWorkingSilently({ status, messages }: CmsChat): boolean {
  const part = messages.at(-1)?.parts.at(-1);
  const animating =
    (part?.type === "text" || part?.type === "reasoning") && part.state === "streaming";

  return status === "submitted" || (status === "streaming" && !animating);
}

export function ChatMessages({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const { messages } = chat;

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className={className}>
        {messages.length === 0 && (
          <ConversationEmptyState
            icon={<Bot className="size-6" />}
            title={t(($) => $.ai.emptyTitle)}
            description={t(($) => $.ai.emptyDescription)}
          />
        )}

        {messages.map((m) => (
          <Message from={m.role} key={m.id}>
            <MessageContent>
              {m.parts.map((part, i) => (
                <MessagePart key={i} part={part} />
              ))}
            </MessageContent>
          </Message>
        ))}

        {isWorkingSilently(chat) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t(($) => $.ai.working)}
          </div>
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
