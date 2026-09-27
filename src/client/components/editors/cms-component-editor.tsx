/**
 * The default editor of a CMS component in the body: a compact block that names
 * the instance and holds its content, while its props are edited in the
 * inspector once it is selected. Structured children are blocks of their own
 * inside it, and markdown children stay editable in place.
 */
import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { CLICK_COMMAND, COMMAND_PRIORITY_LOW, mergeRegister } from "lexical";
import { NestedEditorsContext } from "@mdxeditor/editor";
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
  labelOf,
  missingProps,
  summaryOf,
  updateAt,
  type ChildPath,
} from "@/client/lib/component-tree";
import {
  getSelectedBlock,
  isNodeSelected,
  sameNode,
  select,
  useIsSelected,
  type BlockNode,
  type Crumb,
} from "@/client/stores/inspector-store";
import { useAssetUrl } from "@/client/queries/use-media";
import { ChildListControls, MissingProps } from "@/client/components/editors/block-controls";

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
  const selectSelf = useEffectEvent(() => select({ ...node, path: [], trail }));

  // MDXEditor focuses a component it has just inserted through the emitter,
  // which a nested editor claims for itself. Without one, the component is
  // selected instead, so its props can be filled in right away.
  useEffect(() => {
    if (!hasSlot) focusEmitter.subscribe(() => selectSelf());
  }, [focusEmitter, hasSlot]);

  // Its node selected in the editor, such as with the arrow keys, the component
  // is selected, and it is no longer once the editor's selection moves on. A
  // click on it keeps the selection it makes, which the editor clears otherwise.
  useEffect(
    () =>
      mergeRegister(
        parentEditor.registerUpdateListener(({ editorState, prevEditorState }) => {
          const selected = isNodeSelected(editorState, nodeKey);

          if (selected === isNodeSelected(prevEditorState, nodeKey)) return;

          const current = getSelectedBlock();
          const here = current !== null && sameNode(current, node);

          if (selected && !here) selectSelf();
          else if (!selected && here) select(null);
        }),
        parentEditor.registerCommand(
          CLICK_COMMAND,
          (event, origin) =>
            origin === parentEditor &&
            event.target instanceof Node &&
            parentEditor.getElementByKey(nodeKey)?.contains(event.target) === true,
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [parentEditor, nodeKey, node],
  );

  if (mdastNode.type === "mdxJsxTextElement") {
    return <InlineBlock node={node} element={mdastNode} def={def} trail={trail} />;
  }

  return (
    <div className="my-2">
      <Block node={node} path={[]} element={mdastNode} def={def} outer={trail} crumbs={trail} />
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
  const label = labelOf(def, element);
  const summary = summaryOf(def, element);
  const image = useAssetUrl(imageOf(def, element));
  const Icon = def?.icon;
  const inner = [...crumbs, { label: summary ?? label, selection: { ...block, trail: outer } }];

  const claim = (event: SyntheticEvent<HTMLElement>) => {
    if (ownsEvent(event)) select({ ...block, trail: outer });
  };

  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);

  return (
    <div
      ref={ref}
      data-cms-block
      data-cms-selected={selected || undefined}
      onClickCapture={claim}
      onFocusCapture={claim}
      className="rounded-md border border-border bg-card transition-[border-color,box-shadow] hover:border-ring/60"
    >
      <div className="not-prose flex min-h-9 cursor-default items-center gap-2 px-2 py-1">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="shrink-0 text-xs font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</span>
        {image && <img src={image} alt="" className="size-7 shrink-0 rounded object-cover" />}
        <MissingProps labels={missingProps(def, element)} />
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
      <ChildListControls parent={{ ...node, path, trail: outer }} childDefs={childDefs} />
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
  const label = labelOf(def, element);
  const summary = summaryOf(def, element);
  const Icon = def?.icon;

  const claim = (event: SyntheticEvent<HTMLElement>) => {
    if (ownsEvent(event)) select({ ...block, trail });
  };

  return (
    <span
      data-cms-block
      data-cms-selected={selected || undefined}
      onClickCapture={claim}
      onFocusCapture={claim}
      className="not-prose inline-flex max-w-full items-baseline gap-1 rounded border border-border bg-card px-1.5 align-baseline"
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
