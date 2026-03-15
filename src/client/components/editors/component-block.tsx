import { useCallback } from "react";
import { components } from "virtual:astronaut-cms/user-config";
import { findComponent } from "@/client/lib/component-lookup";
import { FieldRenderer, type ZodFieldSchema } from "./field-renderer";
import { MarkdownEditor } from "./markdown-editor";
import { AddBlockButton } from "./add-block-button";
import { TextBlockEditor } from "./text-block";
import { BlockFrame } from "./block-frame";
import {
  type Block,
  type ComponentBlock,
  getMarkdownContent,
  getSignificantChildren,
  inferChildrenMode,
} from "@/client/lib/block-model";

interface ComponentBlockEditorProps {
  block: ComponentBlock;
  onUpdate: (updater: (block: Block) => Block) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function ComponentBlockEditor({
  block,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ComponentBlockEditorProps) {
  const def = findComponent(block.name, components);
  const schema = def?.props as ZodFieldSchema | null | undefined;

  const label = def?.label ?? block.name;
  const icon = def?.icon;
  const Wrapper = def?.wrapper;

  // Determine children mode from config, with a fallback for unregistered components:
  // if the block has actual children, infer a mode so they're still editable.
  const configChildren = def?.children;
  const childrenMode = inferChildrenMode(configChildren, block.children);

  const handlePropChange = useCallback(
    (key: string, value: unknown) => {
      onUpdate((b) => {
        if (b.type !== "component") return b;
        return { ...b, props: { ...b.props, [key]: value } };
      });
    },
    [onUpdate],
  );

  const handleChildUpdate = useCallback(
    (childId: string, updater: (block: Block) => Block) => {
      onUpdate((b) => {
        if (b.type !== "component") return b;
        return {
          ...b,
          children: b.children.map((c) => (c.id === childId ? updater(c) : c)),
        };
      });
    },
    [onUpdate],
  );

  const handleChildRemove = useCallback(
    (childId: string) => {
      onUpdate((b) => {
        if (b.type !== "component") return b;
        return { ...b, children: b.children.filter((c) => c.id !== childId) };
      });
    },
    [onUpdate],
  );

  const handleAddChild = useCallback(
    (newBlock: Block, index: number) => {
      onUpdate((b) => {
        if (b.type !== "component") return b;
        const children = [...b.children];
        children.splice(index, 0, newBlock);
        return { ...b, children };
      });
    },
    [onUpdate],
  );

  const childComponents = typeof configChildren === "object" ? configChildren : {};
  const significantChildren = getSignificantChildren(block.children);

  const content = (
    <BlockFrame
      icon={icon}
      label={label}
      onRemove={onRemove}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
    >
      <div className="space-y-3 p-3">
        {/* Props form */}
        {schema?.shape && Object.keys(schema.shape).length > 0 && (
          <div className="space-y-2">
            {Object.entries(schema.shape).map(([key, fieldSchema]) => (
              <FieldRenderer
                key={key}
                schema={fieldSchema}
                value={block.props[key]}
                onChange={(v) => handlePropChange(key, v)}
                name={key}
                required={fieldSchema.def.type !== "optional"}
              />
            ))}
          </div>
        )}

        {/* Markdown children */}
        {childrenMode === "markdown" && (
          <MarkdownEditor
            value={getMarkdownContent(block.children)}
            onChange={(value) => {
              onUpdate((b) => {
                if (b.type !== "component") return b;
                return {
                  ...b,
                  children: [
                    {
                      id: b.children.find((c) => c.type === "text")?.id ?? crypto.randomUUID(),
                      type: "text" as const,
                      content: value,
                    },
                  ],
                };
              });
            }}
            rows={4}
            compact
          />
        )}

        {/* Component children (nested blocks) */}
        {childrenMode === "components" && (
          <div className="space-y-2">
            {significantChildren.map((child, index) => (
              <div key={child.id}>
                {child.type === "component" ? (
                  <ComponentBlockEditor
                    block={child}
                    onUpdate={(updater) => handleChildUpdate(child.id, updater)}
                    onRemove={() => handleChildRemove(child.id)}
                  />
                ) : (
                  <TextBlockEditor
                    content={child.content}
                    onChange={(newContent) =>
                      handleChildUpdate(child.id, () => ({
                        ...child,
                        content: newContent,
                      }))
                    }
                    onRemove={() => handleChildRemove(child.id)}
                  />
                )}
                {index < significantChildren.length - 1 && (
                  <div className="my-1">
                    <AddBlockButton
                      onAdd={(newBlock) => handleAddChild(newBlock, index + 1)}
                      availableComponents={childComponents}
                      showTextOption={false}
                    />
                  </div>
                )}
              </div>
            ))}
            <AddBlockButton
              onAdd={(newBlock) => handleAddChild(newBlock, block.children.length)}
              availableComponents={childComponents}
              showTextOption={false}
            />
          </div>
        )}
      </div>
    </BlockFrame>
  );

  if (Wrapper) {
    return <Wrapper>{content}</Wrapper>;
  }
  return content;
}
