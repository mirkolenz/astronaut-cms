import { useCallback, useContext } from "react";
import {
  type JsxEditorProps,
  type MdastJsx,
  NestedLexicalEditor,
  NestedEditorsContext,
  useMdastNodeUpdater,
  useLexicalNodeRemove,
} from "@mdxeditor/editor";
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type { RootContent } from "mdast";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import { components } from "virtual:astronaut-cms/user-config";
import { findComponent } from "@client/lib/component-lookup";
import { FieldRenderer, type ZodFieldSchema, getDefaultValue } from "./field-renderer";
import { Button } from "@client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@client/components/ui/dropdown-menu";

// ── MDAST helpers ───────────────────────────────────────────────────

function extractProps(node: MdastJsx): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  for (const attr of node.attributes) {
    if (attr.type === "mdxJsxAttribute") {
      if (typeof attr.value === "string") {
        props[attr.name] = attr.value;
      } else if (attr.value && typeof attr.value === "object" && "value" in attr.value) {
        try {
          const parsed: unknown = JSON.parse(attr.value.value);
          if (
            typeof parsed === "string" ||
            typeof parsed === "number" ||
            typeof parsed === "boolean"
          ) {
            props[attr.name] = parsed;
          }
        } catch {
          props[attr.name] = attr.value.value;
        }
      } else {
        props[attr.name] = true;
      }
    }
  }
  return props;
}

function propToAttribute(name: string, value: string | number | boolean): MdxJsxAttribute {
  if (value === true) {
    return { type: "mdxJsxAttribute", name, value: null };
  }
  if (typeof value === "string") {
    return { type: "mdxJsxAttribute", name, value };
  }
  return {
    type: "mdxJsxAttribute",
    name,
    value: {
      type: "mdxJsxAttributeValueExpression",
      value: JSON.stringify(value),
    },
  };
}

/**
 * MDXEditor provides children as `RootContent[]` while mdast node types
 * expect narrower arrays (`BlockContent[]` for flow, `PhrasingContent[]`
 * for text). MDXEditor guarantees the children match the node kind at
 * runtime, so the structural cast is safe.
 */
function withUpdatedChildren<T extends MdastJsx>(node: T, children: RootContent[]): T {
  return { ...node, children } as T;
}

function buildDefaultAttributes(def: ClientComponentDef): MdxJsxAttribute[] {
  const shape = (def.props as ZodFieldSchema | null)?.shape;
  if (!shape) return [];
  const attrs: MdxJsxAttribute[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const val = getDefaultValue(fieldSchema);
    if (val === undefined || val === null) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      attrs.push(propToAttribute(key, val));
    }
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
        <Plus className="mr-1 size-3" />
        {def.label}
        {Icon && <Icon className="ml-1 size-3" />}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs">
          <Plus className="mr-1 size-3" />
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

// ── Shared UI for the component block ───────────────────────────────

interface ComponentEditorShellProps {
  mdastNode: MdastJsx;
  descriptor: JsxEditorProps["descriptor"];
  headerActions?: React.ReactNode;
  onPropChange?: (key: string, value: string | number | boolean) => void;
  onAddChild?: (name: string) => void;
}

function ComponentEditorShell({
  mdastNode,
  descriptor,
  headerActions,
  onPropChange,
  onAddChild,
}: ComponentEditorShellProps) {
  const name = descriptor.name ?? "Fragment";
  const def = findComponent(name, components);
  const schema: ZodFieldSchema | null | undefined = def?.props;
  const label = def?.label ?? name;
  const Icon = def?.icon;

  const childrenConfig = def?.children;
  const hasChildren = descriptor.hasChildren;
  const structuredChildDefs = typeof childrenConfig === "object" ? childrenConfig : null;

  const shape = schema?.shape;
  const currentProps = extractProps(mdastNode);

  return (
    <div className="my-2 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        <span className="flex-1 text-sm font-medium">{label}</span>
        {headerActions}
      </div>

      <div className="space-y-3 p-3">
        {shape && Object.keys(shape).length > 0 && onPropChange && (
          <div className="space-y-2">
            {Object.entries(shape).map(([key, fieldSchema]) => (
              <FieldRenderer
                key={key}
                schema={fieldSchema}
                value={currentProps[key]}
                onChange={(v) => {
                  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                    onPropChange(key, v);
                  }
                }}
                name={key}
                required={fieldSchema.def.type !== "optional"}
              />
            ))}
          </div>
        )}

        {hasChildren && (
          <div className="space-y-2">
            <div className="rounded border border-border p-2">
              <NestedLexicalEditor<MdastJsx>
                block={descriptor.kind === "flow"}
                getContent={(node) => node.children as RootContent[]}
                getUpdatedMdastNode={withUpdatedChildren}
              />
            </div>
            {structuredChildDefs && onAddChild && (
              <AddChildButton childDefs={structuredChildDefs} onAdd={onAddChild} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nested component editor (inside a NestedLexicalEditor) ──────────
// Has access to parent editor context for move/delete/update operations.

function NestedCmsComponentEditor({ mdastNode, descriptor }: JsxEditorProps) {
  const updateMdastNode = useMdastNodeUpdater<MdastJsx>();
  const removeNode = useLexicalNodeRemove();
  const { parentEditor, lexicalNode } = useContext(NestedEditorsContext)!;

  const def = findComponent(descriptor.name ?? "", components);
  const structuredChildDefs = typeof def?.children === "object" ? def.children : null;

  const handlePropChange = useCallback(
    (key: string, value: string | number | boolean) => {
      const currentProps = extractProps(mdastNode);
      const updatedProps = { ...currentProps, [key]: value };
      const attributes = Object.entries(updatedProps).map(([k, v]) => propToAttribute(k, v));
      updateMdastNode({ attributes });
    },
    [mdastNode, updateMdastNode],
  );

  const handleMove = useCallback(
    (direction: "up" | "down") => {
      parentEditor.update(() => {
        if (direction === "up") {
          const prev = lexicalNode.getPreviousSibling();
          if (prev) prev.insertBefore(lexicalNode);
        } else {
          const next = lexicalNode.getNextSibling();
          if (next) next.insertAfter(lexicalNode);
        }
      });
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
      const updatedChildren = [...mdastNode.children, newChild];
      updateMdastNode({ children: updatedChildren } as Partial<MdastJsx>);
    },
    [mdastNode, updateMdastNode, structuredChildDefs],
  );

  let hasPrev = false;
  let hasNext = false;
  parentEditor.getEditorState().read(() => {
    hasPrev = lexicalNode.getPreviousSibling() !== null;
    hasNext = lexicalNode.getNextSibling() !== null;
  });

  return (
    <ComponentEditorShell
      mdastNode={mdastNode}
      descriptor={descriptor}
      onPropChange={handlePropChange}
      onAddChild={handleAddChild}
      headerActions={
        <>
          {hasPrev && (
            <Button variant="ghost" size="icon-xs" onClick={() => handleMove("up")}>
              <ArrowUp className="size-3.5" />
            </Button>
          )}
          {hasNext && (
            <Button variant="ghost" size="icon-xs" onClick={() => handleMove("down")}>
              <ArrowDown className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={removeNode}>
            <Trash2 className="size-3.5" />
          </Button>
        </>
      }
    />
  );
}

// ── Root component editor (top-level in MDXEditor) ──────────────────
// No parent editor context — no move/delete (handled by MDXEditor's
// own block controls or backspace).

function RootCmsComponentEditor({ mdastNode, descriptor }: JsxEditorProps) {
  return <ComponentEditorShell mdastNode={mdastNode} descriptor={descriptor} />;
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * Default custom JSX editor for CMS component blocks.
 * Delegates to NestedCmsComponentEditor (with move/delete/update) when
 * inside a NestedLexicalEditor, or RootCmsComponentEditor (read-only
 * structure) at the top level.
 *
 * Can be overridden per-component via `ComponentDefinition.editor`.
 */
export function CmsComponentEditor(props: JsxEditorProps) {
  const nestedContext = useContext(NestedEditorsContext);
  if (nestedContext) {
    return <NestedCmsComponentEditor {...props} />;
  }
  return <RootCmsComponentEditor {...props} />;
}
