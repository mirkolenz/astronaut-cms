import { useTranslation } from "react-i18next";
import { Bot, X } from "lucide-react";
import { ChatComposer } from "@client/components/ai/chat-composer";
import { ChatError, ChatMessages, useCmsChat } from "@client/components/ai/chat-view";
import { Button } from "@client/components/ui/button";
import { useAiPanelStore } from "@client/stores/ai-panel-store";
import { aiConfig } from "@client/lib/ai/config";

export function ChatPanel() {
  const { t } = useTranslation();
  const open = useAiPanelStore((state) => state.open);
  const setOpen = useAiPanelStore((state) => state.setOpen);

  const chat = useCmsChat();

  if (!aiConfig || !open) return null;

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Bot className="size-4" />
          {t(($) => $.ai.title)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label={t(($) => $.ai.close)}
        >
          <X className="size-4" />
        </Button>
      </div>

      <ChatMessages chat={chat} />
      <ChatError chat={chat} className="mx-2 mt-2 shrink-0" />
      <ChatComposer chat={chat} className="m-2 shrink-0" />
    </aside>
  );
}
