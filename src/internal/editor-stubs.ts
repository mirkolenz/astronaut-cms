/**
 * Node stand-ins for `astronaut-cms/editor`, aliased in when the integration
 * loads the user's `cms.config.ts`. That load only reads component schemas, and
 * the real module is the admin's browser bundle, which touches the DOM as it
 * loads. An editor is never rendered there, so none of these ever runs.
 */
import type * as Editor from "../editor.ts";
import type { AssertNever } from "../shared/types.ts";

const adminOnly = (): never => {
  throw new Error("astronaut-cms/editor only runs in the admin.");
};

export const NestedLexicalEditor: typeof Editor.NestedLexicalEditor = adminOnly;
export const useMdastNodeUpdater: typeof Editor.useMdastNodeUpdater = adminOnly;
export const useLexicalNodeRemove: typeof Editor.useLexicalNodeRemove = adminOnly;

// Fails to compile when the editor grows an export this module does not stand
// in for, which would otherwise surface as a failed config load.
export type AllEditorExportsStubbed = AssertNever<
  Exclude<keyof typeof Editor, keyof typeof import("./editor-stubs.ts")>
>;
