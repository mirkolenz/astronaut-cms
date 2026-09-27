/**
 * Node stand-ins for `astronaut-cms/editor`, aliased in when the integration
 * loads the user's `cms.config.ts`. That load only reads component schemas, and
 * the real module is the admin's browser bundle, which touches the DOM as it
 * loads. An editor is never rendered there, so none of these ever runs.
 */
import type { EditorExports } from "../shared/jsx-editor.ts";

const adminOnly = (): never => {
  throw new Error("astronaut-cms/editor only runs in the admin.");
};

export const NestedLexicalEditor: EditorExports["NestedLexicalEditor"] = adminOnly;
export const useMdastNodeUpdater: EditorExports["useMdastNodeUpdater"] = adminOnly;
export const useLexicalNodeRemove: EditorExports["useLexicalNodeRemove"] = adminOnly;
