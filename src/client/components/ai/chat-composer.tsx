import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEventHandler, ClipboardEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { Brain, FileText, Library, Paperclip, SquarePen, X } from "lucide-react";
import { nanoid } from "nanoid";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/client/components/ai-elements/prompt-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { useAiSettingsStore } from "@/client/stores/ai-settings-store";
import { aiConfig } from "@/client/lib/ai/config";
import {
  ATTACHMENT_ACCEPT,
  isImageAttachment,
  prepareMessage,
  type ComposerAttachment,
} from "@/client/lib/ai/attachments";
import { REASONING_EFFORTS, type ReasoningEffort } from "@/client/lib/ai/reasoning";
import { clearChat } from "@/client/lib/ai/chat";
import { toast } from "@/client/components/toast";
import type { CmsChat } from "@/client/components/ai/chat-view";
import type { TFunction } from "i18next";
import { errorMessage } from "@/shared/errors";

function effortLabel(t: TFunction, effort: ReasoningEffort): string {
  switch (effort) {
    case "provider-default":
      return t(($) => $.ai.reasoningDefault);
    case "none":
      return t(($) => $.ai.reasoningNone);
    case "low":
      return t(($) => $.ai.reasoningLow);
    case "medium":
      return t(($) => $.ai.reasoningMedium);
    case "high":
      return t(($) => $.ai.reasoningHigh);
  }
}

function AttachmentChip({
  attachment,
  onRemove,
  onToggleSave,
}: {
  attachment: ComposerAttachment;
  onRemove: (id: string) => void;
  onToggleSave: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { id, file, save } = attachment;
  const isImage = isImageAttachment(file);
  const previewUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-background py-1 pl-1.5 pr-1 text-xs">
      {previewUrl ? (
        <img src={previewUrl} alt={file.name} className="size-7 rounded object-cover" />
      ) : (
        <FileText className="size-4 text-muted-foreground" />
      )}
      <span className="max-w-40 truncate">{file.name}</span>

      {isImage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={save ? "default" : "ghost"}
              aria-pressed={save}
              onClick={() => onToggleSave(id)}
            >
              <Library className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(($) => $.ai.saveToLibrary)}</TooltipContent>
        </Tooltip>
      )}

      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t(($) => $.common.remove)}
        onClick={() => onRemove(id)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

// The chat composer shared by the sidebar panel and the assistant view: a text
// prompt plus attachments. Images are shown to the model and, when their
// library toggle is on, uploaded to the media directory; documents (txt/pdf/
// docx) are extracted to text in the browser and folded into the message.
export function ChatComposer({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const model = useAiSettingsStore((state) => state.model);
  const setModel = useAiSettingsStore((state) => state.setModel);
  const effort = useAiSettingsStore((state) => state.effort);
  const setEffort = useAiSettingsStore((state) => state.setEffort);

  const { sendMessage, status, stop, messages } = chat;
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => {
    const incoming = [...list].map((file) => ({ id: nanoid(), file, save: false }));

    if (incoming.length > 0) setAttachments((prev) => [...prev, ...incoming]);
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const toggleSave = (id: string) =>
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, save: !a.save } : a)));

  const handleInputChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) addFiles(event.currentTarget.files);

    event.currentTarget.value = "";
  };

  // Pasting a file (e.g. a screenshot) attaches it instead of inserting text.
  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const files = [...(event.clipboardData?.files ?? [])];

    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim() ?? "";

    if (!text && attachments.length === 0) return;

    setPreparing(true);

    let prepared;
    try {
      prepared = await prepareMessage(text, attachments);
    } catch (error) {
      toast(errorMessage(error, t(($) => $.ai.attachError)), "error");
      throw error;
    } finally {
      setPreparing(false);
    }

    setAttachments([]);
    void sendMessage({ text: prepared.text, files: prepared.files });
  };

  return (
    <PromptInput onSubmit={handleSubmit} className={className} accept={ATTACHMENT_ACCEPT} multiple>
      {attachments.length > 0 && (
        <PromptInputHeader>
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={removeAttachment}
              onToggleSave={toggleSave}
            />
          ))}
        </PromptInputHeader>
      )}

      <PromptInputBody>
        <PromptInputTextarea placeholder={t(($) => $.ai.placeholder)} onPaste={handlePaste} />
      </PromptInputBody>

      <PromptInputFooter>
        <PromptInputButton
          tooltip={t(($) => $.ai.attach)}
          aria-label={t(($) => $.ai.attach)}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </PromptInputButton>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={handleInputChange}
        />

        {/* Unmounted rather than disabled while there is nothing to clear: the
            surrounding input group mutes its entire contents whenever any
            descendant is disabled. Stops a running turn first; `stop` is a no-op
            when idle. */}
        {messages.length > 0 && (
          <PromptInputButton
            tooltip={t(($) => $.ai.newChat)}
            aria-label={t(($) => $.ai.newChat)}
            onClick={() => {
              void stop();
              clearChat();
            }}
          >
            <SquarePen className="size-4" />
          </PromptInputButton>
        )}

        <Select value={effort} onValueChange={(value) => setEffort(value as ReasoningEffort)}>
          <SelectTrigger
            className="h-7 w-auto min-w-0 gap-1 border-none text-xs shadow-none"
            aria-label={t(($) => $.ai.reasoning)}
          >
            <Brain className="size-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASONING_EFFORTS.map((level) => (
              <SelectItem key={level} value={level}>
                {effortLabel(t, level)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {aiConfig && aiConfig.models.length > 1 && (
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

        <PromptInputSubmit
          className="ml-auto"
          status={preparing ? "submitted" : status}
          onStop={stop}
          disabled={preparing}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}
