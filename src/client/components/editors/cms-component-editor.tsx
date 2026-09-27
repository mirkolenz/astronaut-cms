/**
 * The default editor of a CMS component in the body: a compact block that names
 * the instance and holds its content, while its props are edited in the
 * inspector once it is selected. Structured children are blocks of their own
 * inside it, and markdown children stay editable in place.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { NestedEditorsContext } from "@mdxeditor/editor";
import { cn } from "cn";
import { NestedLexicalEditor, type JsxEditorProps, type MdxJsxElement } from "@/client/editor";
import { components } from "virtual:astronaut-cms/user-config";
import type { ClientComponentDef } from "@/internal/user-config";
import { findComponent } from "@/shared/component-lookup";
import {
  childKey,
  findAt,
  imageOf,
  isJsxElement,
  jsxChildren,
  missingProps,
  summaryOf,
  updateAt,
  type ChildPath,
} from "@/client/lib/component-tree";
import { blockActions, insertChild } from "@/client/lib/block-editing";
import {
  selectBlock,
  useIsSelected,
  type BlockNode,
  type Crumb,
} from "@/client/stores/inspector-store";
import { useAssetUrl } from "@/client/queries/use-media";
import { AddChildMenu, BlockMenu, MissingProps } from "./block-controls";

/** The components enclosing a nested editor, for the breadcrumbs of those written in it. */
const TrailContext = createContext<readonly Crumb[]>([]);

// Blocks nest, and an event is the innermost one's alone. One that only reaches
// a block through a portal, such as a menu, happened elsewhere. Blocks select
// on capture, so a control inside one, such as the add button, can select
// something else after.
function ownsEvent(event: SyntheticEvent<HTMLElement>): boolean {
  const target = event.target;

  return (
    target instanceof Element &&
    event.currentTarget.contains(target) &&
    target.closest("[data-cms-block]") === event.currentTarget
  );
}

export function CmsComponentEditor({ mdastNode }: JsxEditorProps) {
  const { parentEditor, lexicalNode, focusEmitter } = useContext(NestedEditorsContext)!;
  const trail = useContext(TrailContext);
  const nodeKey = lexicalNode.getKey();
  const node = useMemo<BlockNode>(() => ({ editor: parentEditor, nodeKey }), [parentEditor, nodeKey]);
  const def = mdastNode.name ? findComponent(mdastNode.name, components) : undefined;
  const hasSlot = def?.children === "markdown";

  // MDXEditor focuses a component it has just inserted through the emitter,
  // which a nested editor claims for itself. Without one, the component is
  // selected instead, so its props can be filled in right away.
  useEffect(() => {
    if (!hasSlot) focusEmitter.subscribe(() => selectBlock({ ...node, path: [], trail }));
  }, [focusEmitter, hasSlot, node, trail]);

  if (mdastNode.type === "mdxJsxTextElement") {
    return <InlineBlock node={node} element={mdastNode} def={def} trail={trail} />;
  }

  const insertParagraph = (position: "before" | "after") => {
    parentEditor.update(() => {
      const selection = position === "before" ? lexicalNode.selectPrevious() : lexicalNode.selectNext();

      selection.insertParagraph();
    });
    parentEditor.focus();
  };

  return (
    <div className="my-1">
      <GapCursor onClick={() => insertParagraph("before")} />
      <Block node={node} path={[]} element={mdastNode} def={def} outer={trail} crumbs={trail} />
      <GapCursor onClick={() => insertParagraph("after")} />
    </div>
  );
}

interface BlockProps {
  node: BlockNode;
  path: ChildPath;
  element: MdxJsxElement;
  def: ClientComponentDef | undefined;
  /** The enclosing components outside this block's Lexical node. */
  outer: readonly Crumb[];
  /** All enclosing components, those inside the Lexical node included. */
  crumbs: readonly Crumb[];
}

function Block({ node, path, element, def, outer, crumbs }: BlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const block = { ...node, path };
  const { selected, reveal } = useIsSelected(block);
  const label = def?.label ?? element.name ?? "Fragment";
  const summary = summaryOf(def, element);
  const image = useAssetUrl(imageOf(def, element));
  const Icon = def?.icon;
  const inner = [...crumbs, { label: summary ?? label, selection: { ...block, trail: outer } }];

  const select = (event: SyntheticEvent<HTMLElement>) => {
    if (ownsEvent(event)) selectBlock({ ...block, trail: outer });
  };

  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);

  return (
    <div
      ref={ref}
      data-cms-block
      onClickCapture={select}
      onFocusCapture={select}
      className={cn(
        "rounded-md border bg-card transition-[border-color,box-shadow]",
        selected ? "border-ring ring-3 ring-ring/30" : "border-border hover:border-ring/60",
      )}
    >
      <div className="not-prose flex min-h-9 cursor-default items-center gap-2 px-2 py-1">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="shrink-0 text-xs font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</span>
        {image && <img src={image} alt="" className="size-7 shrink-0 rounded object-cover" />}
        <MissingProps labels={missingProps(def, element)} />
        <BlockMenu actions={blockActions(node, path)} />
      </div>
      {def?.children === "markdown" && (
        <div className="border-t border-border px-3 py-2">
          <Slot path={path} element={element} trail={inner} />
        </div>
      )}
      {typeof def?.children === "object" && (
        <ChildBlocks
          node={node}
          path={path}
          element={element}
          childDefs={def.children}
          outer={outer}
          crumbs={inner}
        />
      )}
    </div>
  );
}

/** The markdown children of the element at `path`, edited in place. */
function Slot({ path, element, trail }: { path: ChildPath; element: MdxJsxElement; trail: readonly Crumb[] }) {
  return (
    <TrailContext.Provider value={trail}>
      <NestedLexicalEditor
        getContent={(root) => findAt(root, path)?.children ?? []}
        getUpdatedMdastNode={(root, content) =>
          updateAt(root, path, (target) => ({ ...target, children: content }))
        }
        // Written on one line, a flow component parses as text with inline children.
        block={element.type === "mdxJsxFlowElement"}
      />
    </TrailContext.Provider>
  );
}

function ChildBlocks({
  node,
  path,
  element,
  childDefs,
  outer,
  crumbs,
}: Omit<BlockProps, "def"> & { childDefs: Record<string, ClientComponentDef> }) {
  const { t } = useTranslation();
  // Anything else inside a structured component was written by hand.
  const other = element.children.some(
    (child) => !isJsxElement(child) && !(child.type === "text" && !child.value.trim()),
  );

  return (
    <div className="space-y-2 border-t border-border p-2">
      {jsxChildren(element).map((child) => {
        const key = childKey(child);

        return (
          <Block
            key={key}
            node={node}
            path={[...path, key]}
            element={child}
            def={child.name ? childDefs[child.name] : undefined}
            outer={outer}
            crumbs={crumbs}
          />
        );
      })}
      {other && <p className="not-prose px-1 text-xs text-muted-foreground">{t(($) => $.editors.sourceOnly)}</p>}
      <AddChildMenu
        childDefs={childDefs}
        onAdd={(name, def) => insertChild({ ...node, path, trail: outer }, name, def)}
      />
    </div>
  );
}

/** A component written inside a line of text, as a chip. */
function InlineBlock({
  node,
  element,
  def,
  trail,
}: {
  node: BlockNode;
  element: MdxJsxElement;
  def: ClientComponentDef | undefined;
  trail: readonly Crumb[];
}) {
  const block = { ...node, path: [] };
  const { selected } = useIsSelected(block);
  const label = def?.label ?? element.name ?? "Fragment";
  const summary = summaryOf(def, element);
  const Icon = def?.icon;

  const select = (event: SyntheticEvent<HTMLElement>) => {
    if (ownsEvent(event)) selectBlock({ ...block, trail });
  };

  return (
    <span
      data-cms-block
      onClickCapture={select}
      onFocusCapture={select}
      className={cn(
        "not-prose inline-flex max-w-full items-baseline gap-1 rounded border bg-card px-1.5 align-baseline",
        selected ? "border-ring ring-2 ring-ring/30" : "border-border",
      )}
    >
      {Icon && <Icon className="size-3 shrink-0 self-center text-muted-foreground" />}
      <span className="text-xs font-medium">{label}</span>
      {def?.children === "markdown" ? (
        <span className="cms-inline-slot">
          <Slot
            path={[]}
            element={element}
            trail={[...trail, { label: summary ?? label, selection: { ...block, trail } }]}
          />
        </span>
      ) : (
        summary && <span className="truncate text-muted-foreground">{summary}</span>
      )}
      <MissingProps labels={missingProps(def, element)} />
    </span>
  );
}

function GapCursor({ onClick }: { onClick: () => void }) {
  return (
    <div className="group flex h-2 cursor-text items-center" onClick={onClick}>
      <div className="h-px w-full bg-transparent transition group-hover:bg-primary/40" />
    </div>
  );
}
