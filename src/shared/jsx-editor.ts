/**
 * The contract of `astronaut-cms/editor`, apart from the module that implements
 * it with the admin's MDXEditor. The config and the Node stand-ins are typed by
 * this alone, so neither reaches the editor packages, which only the admin has.
 */
import type { ReactElement, ReactNode } from "react";
import type { RootContent } from "mdast";

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

/** The runtime exports of `astronaut-cms/editor`. */
export interface EditorExports {
  /** A rich-text editor for content nested inside the element, such as its children. */
  NestedLexicalEditor: (props: NestedLexicalEditorProps) => ReactElement;
  /** Merges fields into the element being edited. */
  useMdastNodeUpdater: () => (node: Partial<MdxJsxElement>) => void;
  /** Removes the element being edited from the document. */
  useLexicalNodeRemove: () => () => void;
}
