import { useEffect, useRef, useState } from "react";
import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  KeyboardEventHandler,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Brain, FileText, Library, Paperclip, Square, SquarePen, X } from "lucide-react";
import { nanoid } from "nanoid";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/client/components/ui/attachment";
import { Spinner } from "@/client/components/ui/spinner";
import { IconButton, LabelTooltip } from "@/client/components/icon-button";
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
import type { CmsChat } from "@/client/hooks/use-cms-chat";
import type { TFunction } from "i18next";
import { errorMessage } from "@/shared/errors";

function effortLabel(t: TFunction, effort: ReasoningEffort): string {
  switch (effort) {
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Created and revoked by the same effect, so a remount never shows a revoked URL.
  useEffect(() => {
    if (!isImage) return;

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <Attachment size="sm">
      <AttachmentMedia variant={previewUrl ? "image" : "icon"}>
        {previewUrl ? <img src={previewUrl} alt="" /> : <FileText />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentActions>
        {isImage && (
          <IconButton
            label={t(($) => $.ai.saveToLibrary)}
            variant={save ? "default" : "ghost"}
            aria-pressed={save}
            onClick={() => onToggleSave(id)}
          >
            <Library />
          </IconButton>
        )}
        <IconButton label={t(($) => $.common.remove)} onClick={() => onRemove(id)}>
          <X />
        </IconButton>
      </AttachmentActions>
    </Attachment>
  );
}

/** An icon button in the composer's toolbar, named by its tooltip. */
function ComposerButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <LabelTooltip label={label}>
      <InputGroupButton size="icon-sm" aria-label={label} className={className} onClick={onClick}>
        {children}
      </InputGroupButton>
    </LabelTooltip>
  );
}

// The assistant's chat composer, a text prompt plus attachments.
// Images are shown to the model and, when their library toggle is on, uploaded to the media directory.
// Documents (txt/pdf/docx) are extracted to text in the browser and folded into the message.
export function ChatComposer({ chat, className }: { chat: CmsChat; className?: string }) {
  const { t } = useTranslation();
  const model = useAiSettingsStore((state) => state.model);
  const setModel = useAiSettingsStore((state) => state.setModel);
  const effort = useAiSettingsStore((state) => state.effort);
  const setEffort = useAiSettingsStore((state) => state.setEffort);

  const { sendMessage, status, stop, messages } = chat;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatRevision = useRef(0);
  const submitting = useRef(false);
  const busy = status === "submitted" || status === "streaming";

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

  // Enter sends, Shift+Enter breaks the line, and an IME composition keeps its Enter.
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  // The input keeps its text until the message is sent, so a refused or failed send loses nothing.
  const submit = async () => {
    const prompt = text.trim();
    const revision = chatRevision.current;

    if (submitting.current || busy || (!prompt && attachments.length === 0)) return;

    submitting.current = true;
    setPreparing(true);

    let prepared;
    try {
      prepared = await prepareMessage(prompt, attachments);
    } catch (error) {
      if (revision === chatRevision.current)
        toast(
          errorMessage(
            error,
            t(($) => $.ai.attachError),
          ),
          "error",
        );

      return;
    } finally {
      submitting.current = false;
      setPreparing(false);
    }

    if (revision !== chatRevision.current) return;

    setText("");
    setAttachments([]);
    void sendMessage({ text: prepared.text, files: prepared.files });
  };

  // Nothing in the group is ever disabled, since the group mutes its entire
  // contents whenever any descendant is: what has nothing to do is unmounted
  // instead, and a send while one is prepared is ignored.
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <InputGroup>
        {attachments.length > 0 && (
          <InputGroupAddon align="block-start">
            <AttachmentGroup>
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={removeAttachment}
                  onToggleSave={toggleSave}
                />
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        )}

        <InputGroupTextarea
          value={text}
          placeholder={t(($) => $.ai.placeholder)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <InputGroupAddon align="block-end">
          <ComposerButton
            label={t(($) => $.ai.attach)}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip />
          </ComposerButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={handleInputChange}
          />

          {/* Stops a running turn first, `stop` is a no-op when idle. */}
          {messages.length > 0 && (
            <ComposerButton
              label={t(($) => $.ai.newChat)}
              onClick={() => {
                chatRevision.current++;
                setAttachments([]);
                void stop();
                clearChat();
              }}
            >
              <SquarePen />
            </ComposerButton>
          )}

          <Select
            value={effort}
            onValueChange={(value) => {
              const level = REASONING_EFFORTS.find((option) => option === value);

              if (level) setEffort(level);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-0 gap-1 border-none text-xs shadow-none"
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
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 gap-1 border-none text-xs shadow-none"
                aria-label={t(($) => $.ai.model)}
              >
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

          {busy ? (
            <ComposerButton
              label={t(($) => $.ai.stop)}
              className="ml-auto"
              onClick={() => void stop()}
            >
              <Square />
            </ComposerButton>
          ) : (
            <LabelTooltip label={t(($) => $.ai.send)}>
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                className="ml-auto"
                aria-label={t(($) => $.ai.send)}
                aria-disabled={preparing}
              >
                {preparing ? <Spinner /> : <ArrowUp />}
              </InputGroupButton>
            </LabelTooltip>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
