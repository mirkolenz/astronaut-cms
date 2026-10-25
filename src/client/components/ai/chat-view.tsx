import { useTranslation } from "react-i18next";
import { ArrowDown, Bot } from "lucide-react";
import { isStaticToolUIPart } from "ai";
import { cn } from "cn";
import type { CmsUIMessage } from "@/client/lib/ai/agent";
import { Markdown } from "@/client/components/ai/markdown";
import { ReasoningTrace } from "@/client/components/ai/reasoning-trace";
import { ToolCall } from "@/client/components/ai/tool-call";
import { Button } from "@/client/components/ui/button";
import { ErrorBanner } from "@/client/components/error-banner";
import { Bubble, BubbleContent } from "@/client/components/ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";
import { Message, MessageContent } from "@/client/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { TraceLine, TraceTitle } from "@/client/components/ui/trace";
import type { CmsChat } from "@/client/hooks/use-cms-chat";

/**
 * One part of a message. The models speak the OpenAI-compatible protocol, which
 * never produces the part types left unrendered below (sources, custom provider
 * content), the CMS declares no data parts, and step boundaries carry no content
 * of their own. Hence the bare null.
 */
function MessagePart({
  part,
  role,
}: {
  part: CmsUIMessage["parts"][number];
  role: CmsUIMessage["role"];
}) {
  if (part.type === "text") {
    return role === "user" ? (
      <Bubble variant="muted">
        <BubbleContent className="whitespace-pre-wrap">{part.text}</BubbleContent>
      </Bubble>
    ) : (
      <Markdown streaming={part.state === "streaming"}>{part.text}</Markdown>
    );
  }

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
 * streaming reasoning draw themselves as they arrive.
 * Everything else is a silent wait, such as the prefill before a step's first token,
 * a tool's arguments streaming into a collapsed card, the tool running,
 * and the model being called again with its result.
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
  // Only the turn the user sent last anchors, so a resumed conversation opens at its end.
  const anchor = messages.findLastIndex((m) => m.role === "user");

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className={cn("py-4", className)}>
            {messages.length === 0 && (
              <MessageScrollerItem className="flex flex-1">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Bot />
                    </EmptyMedia>
                    <EmptyTitle>{t(($) => $.ai.emptyTitle)}</EmptyTitle>
                    <EmptyDescription>{t(($) => $.ai.emptyDescription)}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}

            {messages.map((m, index) => (
              <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={index === anchor}>
                <Message align={m.role === "user" ? "end" : "start"}>
                  <MessageContent>
                    {m.parts.map((part, i) => (
                      <MessagePart key={i} part={part} role={m.role} />
                    ))}
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}

            {isWorkingSilently(chat) && (
              <MessageScrollerItem>
                <TraceLine status="running">
                  <TraceTitle>{t(($) => $.ai.working)}</TraceTitle>
                </TraceLine>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton>
          <ArrowDown />
          <span className="sr-only">{t(($) => $.ai.scrollToEnd)}</span>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function ChatError({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const { error, regenerate } = chat;

  if (!error) return null;

  return (
    <ErrorBanner
      title={t(($) => $.ai.errorTitle)}
      className={className}
      action={
        <Button variant="outline" size="sm" onClick={() => void regenerate()}>
          {t(($) => $.ai.retry)}
        </Button>
      }
    >
      {error.message && <p className="break-words">{error.message}</p>}
    </ErrorBanner>
  );
}
