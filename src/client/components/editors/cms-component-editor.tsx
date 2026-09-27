import { useCallback, useContext } from "react";
import {
  type JsxEditorProps,
  type MdastJsx,
  NestedLexicalEditor,
  NestedEditorsContext,
  useMdastNodeUpdater,
  useLexicalNodeRemove,
} from "@mdxeditor/editor";
import { $copyNode } from "lexical";
import type {
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
  MdxJsxFlowElement,
} from "mdast-util-mdx-jsx";
import type { RootContent } from "mdast";
import { ArrowUp, ArrowDown, Trash2, Copy, Plus } from "lucide-react";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import { components } from "virtual:astronaut-cms/user-config";
import { findComponent } from "@/shared/component-lookup";
import { isRequired, objectShape } from "@/shared/field-schema";
import { attributeValue, valueToAttribute } from "@/shared/mdx-attributes";
import { FieldRenderer, getDefaultValue } from "./field-renderer";
import { EditorCard } from "./editor-card";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

// ── MDAST helpers ───────────────────────────────────────────────────

/**
 * The statically-known props of a node. An expression only a runtime can produce
 * is left out: the form cannot show it, and {@link CmsComponentEditor} rewrites
 * an attribute only when its own field is edited, so it survives untouched.
 */
function extractProps(node: MdastJsx): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  for (const attr of node.attributes) {
    if (attr.type !== "mdxJsxAttribute") continue;

    const value = attributeValue(attr);

    if (value.known) props[attr.name] = value.value;
  }

  return props;
}

function buildDefaultAttributes(def: ClientComponentDef): MdxJsxAttribute[] {
  const shape = objectShape(def.props);
  if (!shape) return [];
  const attrs: MdxJsxAttribute[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const val = getDefaultValue(fieldSchema);
    if (val === undefined || val === null) continue;
    attrs.push(valueToAttribute(key, val));
  }
  return attrs;
}

// ── Add child button (scoped to allowed child types) ────────────────

function AddChildButton({
  childDefs,
  onAdd,
}: {
  childDefs: Record<string, ClientComponentDef>;
  onAdd: (name: string) => void;
}) {
  const entries = Object.entries(childDefs);
  if (entries.length === 0) return null;

  if (entries.length === 1) {
    const [name, def] = entries[0];
    const Icon = def.icon;
    return (
      <Button variant="outline" size="xs" onClick={() => onAdd(name)}>
        <Plus className="size-3" />
        {def.label}
        {Icon && <Icon className="size-3" />}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs">
          <Plus className="size-3" />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {entries.map(([name, def]) => {
          const Icon = def.icon;
          return (
            <DropdownMenuItem key={name} onSelect={() => onAdd(name)}>
              {Icon && <Icon className="mr-2 size-4" />}
              {def.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * Default custom JSX editor for CMS component blocks.
 * Can be overridden per-component via `ComponentDefinition.editor`.
 */
export function CmsComponentEditor({ mdastNode, descriptor }: JsxEditorProps) {
  const updateMdastNode = useMdastNodeUpdater<MdastJsx>();
  const removeNode = useLexicalNodeRemove();
  const { parentEditor, lexicalNode } = useContext(NestedEditorsContext)!;

  const name = descriptor.name ?? "Fragment";
  const def = findComponent(name, components);
  const label = def?.label ?? name;
  const Icon = def?.icon;
  const shape = objectShape(def?.props);
  const childrenConfig = def?.children;
  const structuredChildDefs = typeof childrenConfig === "object" ? childrenConfig : null;

  // Read sibling state from the parent editor (safe: committed state).
  let hasPrev = false;
  let hasNext = false;
  parentEditor.getEditorState().read(() => {
    hasPrev = lexicalNode.getPreviousSibling() !== null;
    hasNext = lexicalNode.getNextSibling() !== null;
  });

  // Only the edited attribute is rewritten, so a spread and any expression the
  // form cannot render keep their source text rather than being serialized back
  // from what little `extractProps` could read. Clearing a prop removes it.
  const handlePropChange = useCallback(
    (key: string, value: unknown) => {
      const isTarget = (attr: MdxJsxAttribute | MdxJsxExpressionAttribute) =>
        attr.type === "mdxJsxAttribute" && attr.name === key;

      if (value === undefined) {
        updateMdastNode({ attributes: mdastNode.attributes.filter((attr) => !isTarget(attr)) });

        return;
      }

      const attribute = valueToAttribute(key, value);

      updateMdastNode({
        attributes: mdastNode.attributes.some(isTarget)
          ? mdastNode.attributes.map((attr) => (isTarget(attr) ? attribute : attr))
          : [...mdastNode.attributes, attribute],
      });
    },
    [mdastNode, updateMdastNode],
  );

  const handleMove = useCallback(
    (direction: "up" | "down") => {
      parentEditor.update(() => {
        const sibling =
          direction === "up" ? lexicalNode.getPreviousSibling() : lexicalNode.getNextSibling();
        if (sibling) {
          if (direction === "up") sibling.insertBefore(lexicalNode);
          else sibling.insertAfter(lexicalNode);
        }
      });
    },
    [parentEditor, lexicalNode],
  );

  const handleDuplicate = useCallback(() => {
    parentEditor.update(() => {
      lexicalNode.insertAfter($copyNode(lexicalNode));
    });
  }, [parentEditor, lexicalNode]);

  const handleGapCursor = useCallback(
    (position: "before" | "after") => {
      parentEditor.update(() => {
        const sel = position === "before" ? lexicalNode.selectPrevious() : lexicalNode.selectNext();
        sel.insertParagraph();
      });
      parentEditor.focus();
    },
    [parentEditor, lexicalNode],
  );

  const handleAddChild = useCallback(
    (childName: string) => {
      if (!structuredChildDefs) return;
      const childDef = structuredChildDefs[childName];
      if (!childDef) return;
      const newChild: MdxJsxFlowElement = {
        type: "mdxJsxFlowElement",
        name: childName,
        attributes: buildDefaultAttributes(childDef),
        children: [],
      };
      updateMdastNode({
        children: [...mdastNode.children, newChild],
      } as Partial<MdastJsx>);
    },
    [mdastNode, updateMdastNode, structuredChildDefs],
  );

  const currentProps = extractProps(mdastNode);

  return (
    <div className="my-1">
      <GapCursor onClick={() => handleGapCursor("before")} />
      <EditorCard
        title={label}
        icon={Icon}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasPrev}
              onClick={() => handleMove("up")}
            >
              <ArrowUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasNext}
              onClick={() => handleMove("down")}
            >
              <ArrowDown className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={handleDuplicate}>
              <Copy className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={removeNode}>
              <Trash2 className="size-3" />
            </Button>
          </>
        }
      >
        {shape && Object.keys(shape).length > 0 && (
          <div className="space-y-2">
            {Object.entries(shape).map(([key, fieldSchema]) => (
              <FieldRenderer
                key={key}
                schema={fieldSchema}
                value={currentProps[key]}
                onChange={(v) => handlePropChange(key, v)}
                name={key}
                required={isRequired(fieldSchema)}
              />
            ))}
          </div>
        )}

        {descriptor.hasChildren && (
          <NestedLexicalEditor<MdastJsx>
            key={
              mdastNode.children.filter(
                (c) => c.type === "mdxJsxFlowElement" || c.type === "mdxJsxTextElement",
              ).length
            }
            block={descriptor.kind === "flow"}
            getContent={(node) => node.children as RootContent[]}
            getUpdatedMdastNode={(node, children) => ({ ...node, children }) as MdastJsx}
          />
        )}

        {structuredChildDefs && (
          <AddChildButton childDefs={structuredChildDefs} onAdd={handleAddChild} />
        )}
      </EditorCard>
      <GapCursor onClick={() => handleGapCursor("after")} />
    </div>
  );
}

function GapCursor({ onClick }: { onClick: () => void }) {
  return (
    <div className="group flex h-2 cursor-text items-center" onClick={onClick}>
      <div className="h-px w-full bg-transparent transition group-hover:bg-primary/40" />
    </div>
  );
}
