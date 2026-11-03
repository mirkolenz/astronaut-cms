import { expect, it } from "vitest";
import { $createParagraphNode, $getRoot } from "lexical";
import { isNodeSelected, select } from "@/client/stores/inspector-store";
import { newEditor } from "@tests/fixtures/editor";

it("selects a block as a node of its editor, and lets go of it again", () => {
  const editor = newEditor();
  let nodeKey = "";

  editor.update(
    () => {
      const node = $createParagraphNode();

      $getRoot().append(node);
      nodeKey = node.getKey();
    },
    { discrete: true },
  );

  select({ editor, nodeKey, path: [], trail: [] });
  expect(isNodeSelected(editor.getEditorState(), nodeKey)).toBe(true);

  select(null);
  expect(isNodeSelected(editor.getEditorState(), nodeKey)).toBe(false);
});
