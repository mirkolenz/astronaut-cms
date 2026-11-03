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
import { createElement } from "react";
import {
  NestedLexicalEditor as MdxNestedLexicalEditor,
  useLexicalNodeRemove as useMdxLexicalNodeRemove,
  useMdastNodeUpdater as useMdxMdastNodeUpdater,
  type MdastJsx,
} from "@mdxeditor/editor";
import type { EditorExports } from "@/shared/jsx-editor";

export type * from "@/shared/jsx-editor";

export const NestedLexicalEditor: EditorExports["NestedLexicalEditor"] = ({
  getUpdatedMdastNode,
  ...props
}) =>
  createElement(MdxNestedLexicalEditor<MdastJsx>, {
    ...props,
    getUpdatedMdastNode: (node, content) => getUpdatedMdastNode(node, content) as MdastJsx,
  });

export const useMdastNodeUpdater: EditorExports["useMdastNodeUpdater"] = () => {
  const update = useMdxMdastNodeUpdater<MdastJsx>();

  return (node) => update(node as Partial<MdastJsx>);
};

export const useLexicalNodeRemove: EditorExports["useLexicalNodeRemove"] = useMdxLexicalNodeRemove;
