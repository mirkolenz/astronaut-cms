import { useState, useRef, useCallback } from "react";
import { type ToolbarAction, toolbarActions } from "./markdown-toolbar";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { useEntryContext } from "@/client/lib/entry-context";
import { toRelativeAssetPath } from "@/client/lib/asset-utils";

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
          <button
            key={action.label}
            type="button"
            title={action.label}
            onClick={() => handleAction(action)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {action.icon}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full resize-y border-0 bg-white p-3 font-mono text-sm leading-relaxed focus:outline-none dark:bg-gray-900"
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
