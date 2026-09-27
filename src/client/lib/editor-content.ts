/**
 * Content moving in and out of the body editor as MDX. It is read, written and
 * inserted with the editor's own parser, serializer and import visitors, so a
 * copy reads back exactly as the file would.
 */
import i18n from "i18next";
import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  type DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import {
  Cell,
  activeEditor$,
  codeBlockEditorDescriptors$,
  defaultCodeBlockLanguage$,
  directiveDescriptors$,
  importMdastTreeToLexical,
  importVisitors$,
  jsxComponentDescriptors$,
  jsxKindMismatchPolicy$,
  mdastExtensions$,
  openNewImageDialog$,
  syntaxExtensions$,
  toMarkdownExtensions$,
  toMarkdownOptions$,
  type ImportPoint,
  type Realm,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import type { ClientComponentDef } from "@/internal/user-config";
import { findComponent } from "@/shared/component-lookup";
import { asBlockContent, isJsxElement, misplacedComponents, type JsxChild } from "@/client/lib/component-tree";
import { $caretBlock, $isEmptyLine } from "@/client/lib/empty-lines";
import { toast } from "@/client/components/toast";

// MDXEditor exports the extensions it reads and writes markdown with, but its
// declarations leave them out as internal. The names are MDXEditor's own.
declare module "@mdxeditor/editor" {
  export const mdastExtensions$: ReturnType<typeof Cell<MdastExtensions>>;
  export const toMarkdownExtensions$: ReturnType<typeof Cell<ToMarkdownOptions[]>>;
  export const toMarkdownOptions$: ReturnType<typeof Cell<ToMarkdownOptions>>;
}

export function parseMdx(realm: Realm, text: string): Root {
  return fromMarkdown(text, {
    extensions: realm.getValue(syntaxExtensions$),
    mdastExtensions: realm.getValue(mdastExtensions$),
  });
}

export function toMdx(realm: Realm, nodes: RootContent[]): string {
  return toMarkdown(
    { type: "root", children: nodes },
    { extensions: realm.getValue(toMarkdownExtensions$), ...realm.getValue(toMarkdownOptions$) },
  ).trim();
}

/** Where content goes: next to a top-level block of an editor, or where its caret is. */
export interface InsertTarget {
  editor: LexicalEditor;
  at?: { nodeKey: NodeKey; position: "before" | "after" };
}

/** Whether the editor with this root element holds a line of text, which takes no blocks. */
export function isInlineRoot(root: Element): boolean {
  return root.closest(".cms-inline-slot, td, th") !== null;
}

/** Whether content goes into a line of text, which takes neither blocks nor block components. */
export function isInlineTarget({ editor, at }: InsertTarget): boolean {
  const root = editor.getRootElement();

  return !at && root !== null && isInlineRoot(root);
}

export const inlineComponents = Object.fromEntries(
  Object.entries(components).filter(([, def]) => def.kind === "text"),
);

// A block goes onto an empty line of its own, next to the target block or the
// caret's, so it never splits the text around it.
function $moveToEmptyLine(at: InsertTarget["at"]): void {
  if (!at && !$isRangeSelection($getSelection())) $getRoot().selectEnd();

  const node = at ? $getNodeByKey(at.nodeKey) : $caretBlock();
  const position = at?.position ?? "after";

  if (!node || (!at && $isEmptyLine(node))) return;

  const neighbor = position === "before" ? node.getPreviousSibling() : node.getNextSibling();
  const line = $isEmptyLine(neighbor) ? neighbor : $createParagraphNode();

  if (line !== neighbor) {
    if (position === "before") node.insertBefore(line);
    else node.insertAfter(line);
  }

  line.select();
}

// MDXEditor focuses a component, code block or table through the editor it renders.
function isSelectable(node: DecoratorNode<unknown>): node is DecoratorNode<unknown> & { select: () => void } {
  return "select" in node && typeof node.select === "function";
}

function $lastDecorator(nodes: LexicalNode[]): DecoratorNode<unknown> | undefined {
  for (const node of nodes.toReversed()) {
    const found = $isElementNode(node) ? $lastDecorator(node.getChildren()) : node;

    if ($isDecoratorNode(found)) return found;
  }

  return undefined;
}

/**
 * Inserts content at a target and moves the focus into it. With `atCaret`,
 * it goes right where the caret is, as a paste does, and on a line of its own
 * otherwise.
 */
export function insertContent(
  realm: Realm,
  { editor, at }: InsertTarget,
  nodes: RootContent[],
  { atCaret = false } = {},
): void {
  let focus: DecoratorNode<unknown> | undefined;

  editor.update(
    () => {
      if (at || !atCaret) $moveToEmptyLine(at);

      const inserted: LexicalNode[] = [];
      const point: ImportPoint = { append: (node) => inserted.push(node), getType: () => "root" };

      importMdastTreeToLexical({
        root: point,
        mdastRoot: { type: "root", children: nodes },
        visitors: realm.getValue(importVisitors$),
        jsxComponentDescriptors: realm.getValue(jsxComponentDescriptors$),
        jsxKindMismatchPolicy: realm.getValue(jsxKindMismatchPolicy$),
        directiveDescriptors: realm.getValue(directiveDescriptors$),
        codeBlockEditorDescriptors: realm.getValue(codeBlockEditorDescriptors$),
        defaultCodeBlockLanguage: realm.getValue(defaultCodeBlockLanguage$),
      });

      focus = $lastDecorator(inserted);

      if (inserted.length > 0) $insertNodes(inserted);
    },
    { discrete: true },
  );

  if (focus && isSelectable(focus)) {
    // Only once its editor has rendered.
    const node = focus;

    setTimeout(() => node.select());
  } else {
    editor.focus();
  }
}

/** Opens MDXEditor's image dialog, which inserts the image on an empty line at the target. */
export function insertImage(realm: Realm, { editor, at }: InsertTarget): void {
  editor.update(() => $moveToEmptyLine(at), { discrete: true });
  realm.pub(activeEditor$, editor);
  realm.pub(openNewImageDialog$);
}

// ── Pasting ─────────────────────────────────────────────────────────

/**
 * Parses pasted MDX for a place that takes the `allowed` components, and `fit`
 * turns it into the content that goes there. Otherwise the user learns why it
 * does not go there.
 */
function pastedContent<T>(
  realm: Realm,
  text: string,
  allowed: Record<string, ClientComponentDef>,
  fit: (nodes: RootContent[]) => T[] | undefined,
): T[] | undefined {
  let nodes: RootContent[];

  try {
    // The editor writes the imports of the components the body uses itself.
    nodes = parseMdx(realm, text).children.filter((node) => node.type !== "mdxjsEsm");
  } catch {
    toast(i18n.t(($) => $.editors.pasteInvalid), "error");

    return undefined;
  }

  const misplaced = misplacedComponents(nodes, allowed, components);

  if (misplaced.length > 0) {
    const names = [...new Set(misplaced.map((name) => findComponent(name, components)?.label ?? name))];

    toast(i18n.t(($) => $.editors.pasteMisplaced, { names: names.join(", ") }), "error");

    return undefined;
  }

  const content = fit(nodes);

  if (!content) toast(i18n.t(($) => $.editors.pasteUnfit), "error");

  return content;
}

// An inline component copied on its own reads back as a block, so it goes back into a line of text.
function inlined(node: RootContent): RootContent {
  if (node.type !== "mdxJsxFlowElement" || !node.name || !inlineComponents[node.name]) return node;

  const children = node.children.flatMap((child) => (child.type === "paragraph" ? child.children : []));

  return asBlockContent({ ...node, type: "mdxJsxTextElement", children });
}

/** Pastes MDX into text, where only a line of text goes into an inline editor. */
export function pasteText(realm: Realm, target: InsertTarget, text: string): void {
  const inline = isInlineTarget(target);
  const nodes = pastedContent(realm, text, inline ? inlineComponents : components, (parsed) => {
    const content = parsed.map(inlined);

    return !inline || (content.length === 1 && content[0]?.type === "paragraph") ? content : undefined;
  });

  if (nodes && nodes.length > 0) insertContent(realm, target, nodes, { atCaret: true });
}

/** Pasted MDX as structured children, which must all be components the parent takes. */
export function pastedChildren(
  realm: Realm,
  text: string,
  childDefs: Record<string, ClientComponentDef>,
): JsxChild[] | undefined {
  return pastedContent(realm, text, childDefs, (nodes) => {
    const children = nodes.filter(isJsxElement);

    return children.length === nodes.length ? children : undefined;
  });
}

/** Whether pasted text is written as a component, which then is inserted as one. */
export function isComponentMdx(text: string): boolean {
  const name = /^\s*<([A-Za-z][\w.]*)/.exec(text)?.[1];

  return name !== undefined && findComponent(name, components) !== undefined;
}

// The browser may deny access to the clipboard, which the user learns of.
async function withClipboard<T>(use: (clipboard: Clipboard) => Promise<T>): Promise<T | undefined> {
  try {
    return await use(navigator.clipboard);
  } catch {
    toast(i18n.t(($) => $.editors.clipboardDenied), "error");

    return undefined;
  }
}

export const readClipboard = (): Promise<string | undefined> => withClipboard((clipboard) => clipboard.readText());

/** Writes text to the clipboard, and tells whether it did. */
export const writeClipboard = async (text: string): Promise<boolean> =>
  (await withClipboard((clipboard) => clipboard.writeText(text).then(() => true))) ?? false;
