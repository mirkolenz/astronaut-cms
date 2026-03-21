import { useState, useRef, useCallback } from "react";
import { type ToolbarAction, toolbarActions } from "./markdown-toolbar";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { useEntryContext } from "@/client/lib/entry-context";
import { toRelativeAssetPath } from "@/client/lib/asset-utils";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/client/components/ui/tooltip";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  compact?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  rows = 20,
  compact = false,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const ctx = useEntryContext();

  const handleAction = useCallback(
    (action: ToolbarAction) => {
      if (action.id === "image") {
        setShowMediaPicker(true);
        return;
      }
      const ta = textareaRef.current;
      if (!ta) return;
      const result = action.action(ta);
      onChange(result.value);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.selStart, result.selEnd);
      });
    },
    [onChange],
  );

  const handleMediaSelect = useCallback(
    (assetPath: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const relativePath = ctx ? toRelativeAssetPath(ctx.contentFilePath, assetPath) : assetPath;
      const { selectionStart, selectionEnd } = ta;
      const insert = `![](${relativePath})`;
      const newValue = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
      onChange(newValue);
      setShowMediaPicker(false);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = selectionStart + insert.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [value, onChange, ctx],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const { selectionStart, selectionEnd } = ta;
        const newValue = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
        onChange(newValue);
        requestAnimationFrame(() => {
          ta.setSelectionRange(selectionStart + 2, selectionStart + 2);
        });
      }
    },
    [value, onChange],
  );

  return (
    <div
      className={`overflow-hidden rounded-md border border-gray-300 dark:border-gray-600${compact ? " text-sm" : ""}`}
    >
      <div className="flex flex-wrap gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
        {toolbarActions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => handleAction(action)}
              >
                <action.icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="resize-y rounded-none border-0 font-mono leading-relaxed shadow-none focus-visible:ring-0"
        rows={rows}
      />
      <MediaPickerDialog
        open={showMediaPicker}
        onSelect={handleMediaSelect}
        onCancel={() => setShowMediaPicker(false)}
      />
    </div>
  );
}
