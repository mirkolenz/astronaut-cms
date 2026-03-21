import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "./markdown-editor";
import { BlockFrame } from "./block-frame";

interface TextBlockProps {
  content: string;
  onChange: (content: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function TextBlockEditor({
  content,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TextBlockProps) {
  const { t } = useTranslation();
  const handleChange = useCallback((value: string) => onChange(value), [onChange]);

  return (
    <BlockFrame
      icon="&#x1F4DD;"
      label={t($ => $.editors.text)}
      onRemove={onRemove}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
    >
      <div className="p-3">
        <MarkdownEditor value={content} onChange={handleChange} rows={6} compact />
      </div>
    </BlockFrame>
  );
}
