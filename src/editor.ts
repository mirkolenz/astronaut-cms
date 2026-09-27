/**
 * What a custom component `editor` in `cms.config` is built with: the props it
 * is handed and the editing primitives of the admin's MDXEditor. The admin
 * bundles its editor, so these are the only handles on that very instance. A
 * separate install of `@mdxeditor/editor` would be a second copy whose hooks
 * find none of the admin's state.
 *
 * The types are the CMS's own, so a site needs no editor packages installed to
 * check its config.
 */
import { createElement, type ReactElement, type ReactNode } from "react";
import type { RootContent } from "mdast";
import {
  NestedLexicalEditor as MdxNestedLexicalEditor,
  useLexicalNodeRemove as useMdxLexicalNodeRemove,
  useMdastNodeUpdater as useMdxMdastNodeUpdater,
  type MdastJsx,
} from "@mdxeditor/editor";

/** `name="value"`, or `name={expression}` with the expression as source text. */
export interface MdxJsxAttribute {
  type: "mdxJsxAttribute";
  name: string;
  value?: string | { type: "mdxJsxAttributeValueExpression"; value: string } | null;
}

/** `{...expression}`, as source text. */
export interface MdxJsxExpressionAttribute {
  type: "mdxJsxExpressionAttribute";
  value: string;
}

/** The MDX element a component is written as. */
export interface MdxJsxElement {
  type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  name: string | null;
  attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[];
  children: RootContent[];
}

/** The props a custom editor is rendered with. */
export interface JsxEditorProps {
  /** The element being edited. */
  mdastNode: MdxJsxElement;
  /** The component the element renders. */
  descriptor: { name: string | null; kind: "flow" | "text"; hasChildren?: boolean };
}

/** A component's own editor in the admin, in place of the generated form. */
export type JsxEditor = (props: JsxEditorProps) => ReactNode;

export interface NestedLexicalEditorProps {
  /** The part of the element to edit, usually its `children`. */
  getContent: (node: MdxJsxElement) => RootContent[];
  /** The element with the edited content put back. */
  getUpdatedMdastNode: (node: MdxJsxElement, content: RootContent[]) => MdxJsxElement;
  /** Whether the content is blocks (paragraphs, lists) rather than inline text. */
  block?: boolean;
}

/** A rich-text editor for content nested inside the element, such as its children. */
export function NestedLexicalEditor({
  getUpdatedMdastNode,
  ...props
}: NestedLexicalEditorProps): ReactElement {
  return createElement(MdxNestedLexicalEditor<MdastJsx>, {
    ...props,
    getUpdatedMdastNode: (node, content) => getUpdatedMdastNode(node, content) as MdastJsx,
  });
}

/** Merges fields into the element being edited. */
export function useMdastNodeUpdater(): (node: Partial<MdxJsxElement>) => void {
  const update = useMdxMdastNodeUpdater<MdastJsx>();

  return (node) => update(node as Partial<MdastJsx>);
}

/** Removes the element being edited from the document. */
export function useLexicalNodeRemove(): () => void {
  return useMdxLexicalNodeRemove();
}
