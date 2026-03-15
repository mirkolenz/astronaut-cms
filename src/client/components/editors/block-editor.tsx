import { useEffect, useCallback, useRef } from "react";
import { components } from "virtual:astronaut-cms/user-config";
import { useBlockEditor } from "@/client/lib/use-block-editor";
import { AddBlockButton } from "./add-block-button";
import { TextBlockEditor } from "./text-block";
import { ComponentBlockEditor } from "./component-block";

interface BlockEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function BlockEditor({ value, onChange }: BlockEditorProps) {
  const { blocks, updateBlock, addBlock, removeBlock, moveBlock, serialize } =
    useBlockEditor(value);

  // Debounce serialization to avoid running on every keystroke
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const serialized = serialize();
      onChange(serialized);
    }, 150);
    return () => clearTimeout(timerRef.current);
  }, [blocks, serialize, onChange]);

  const handleAddAtRoot = useCallback(
    (block: Parameters<typeof addBlock>[0], index: number) => {
      addBlock(block, null, index);
    },
    [addBlock],
  );

  return (
    <div className="space-y-2 pt-4">
      <AddBlockButton
        onAdd={(block) => handleAddAtRoot(block, 0)}
        availableComponents={components}
      />

      {blocks.map((block, index) => (
        <div key={block.id}>
          {block.type === "text" ? (
            <TextBlockEditor
              content={block.content}
              onChange={(content) =>
                updateBlock(block.id, () => ({
                  ...block,
                  content,
                }))
              }
              onRemove={() => removeBlock(block.id)}
              onMoveUp={index > 0 ? () => moveBlock(block.id, "up") : undefined}
              onMoveDown={index < blocks.length - 1 ? () => moveBlock(block.id, "down") : undefined}
            />
          ) : (
            <ComponentBlockEditor
              block={block}
              onUpdate={(updater) => updateBlock(block.id, updater)}
              onRemove={() => removeBlock(block.id)}
              onMoveUp={index > 0 ? () => moveBlock(block.id, "up") : undefined}
              onMoveDown={index < blocks.length - 1 ? () => moveBlock(block.id, "down") : undefined}
            />
          )}

          <div className="my-2">
            <AddBlockButton
              onAdd={(newBlock) => handleAddAtRoot(newBlock, index + 1)}
              availableComponents={components}
            />
          </div>
        </div>
      ))}

      {blocks.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-gray-600">
          No content yet. Click "Add block" to get started.
        </div>
      )}
    </div>
  );
}
