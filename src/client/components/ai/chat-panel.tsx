import { useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot, X } from "lucide-react";
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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@client/components/ai-elements/tool";
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

export function ChatPanel() {
  const { t } = useTranslation();
  const open = useAiPanelStore((state) => state.open);
  const setOpen = useAiPanelStore((state) => state.setOpen);
  const model = useAiPanelStore((state) => state.model);
  const setModel = useAiPanelStore((state) => state.setModel);

  // A single shared Chat whose messages survive the dev-server reloads that
  // content edits trigger (see getChat); mirror every change to storage.
  const { messages, sendMessage, status, stop, error } = useChat({ chat: getChat() });

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  if (!aiConfig || !open) return null;

  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text?.trim()) void sendMessage({ text: message.text });
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Bot className="size-4" />
          {t($ => $.ai.title)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label={t($ => $.ai.close)}
        >
          <X className="size-4" />
        </Button>
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
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
                      const toolPart = part as ToolUIPart;

                      return (
                        <Tool key={i}>
                          <ToolHeader type={toolPart.type} state={toolPart.state} />
                          <ToolContent>
                            <ToolInput input={toolPart.input} />
                            <ToolOutput
                              output={toolPart.output}
                              errorText={toolPart.errorText}
                            />
                          </ToolContent>
                        </Tool>
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
          className="mx-2 mt-2 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {t($ => $.ai.errorTitle)}
          </div>
          {error.message && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      )}

      <PromptInput onSubmit={handleSubmit} className="m-2 shrink-0">
        <PromptInputBody>
          <PromptInputTextarea placeholder={t($ => $.ai.placeholder)} />
        </PromptInputBody>
        <PromptInputFooter>
          {aiConfig.models.length > 1 && (
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-7 w-auto gap-1 border-none text-xs shadow-none">
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
    </aside>
  );
}
