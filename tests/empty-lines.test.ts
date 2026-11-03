import { describe, expect, it } from "vitest";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { $moveToEmptyLine, pruneEmptyLines } from "@/client/lib/empty-lines";
import { newEditor } from "@tests/fixtures/editor";

const lines = (editor: LexicalEditor) =>
  editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getTextContent()),
  );

describe("empty lines", () => {
  it("removes the empty lines the caret has left", () => {
    const editor = newEditor();

    editor.update(
      () => {
        const caret = $createParagraphNode();

        $getRoot().append(
          $createParagraphNode().append($createTextNode("a")),
          $createParagraphNode(),
          caret,
          $createParagraphNode().append($createTextNode("b")),
        );
        caret.select();
      },
      { discrete: true },
    );

    pruneEmptyLines(editor);
    expect(lines(editor)).toEqual(["a", "", "b"]);

    pruneEmptyLines(editor, { keepCaret: false });
    expect(lines(editor)).toEqual(["a", "b"]);
  });

  it("gives a block selected as a whole a line right after it", () => {
    const editor = newEditor();

    editor.update(
      () => {
        const block = $createParagraphNode().append($createTextNode("a"));
        const selection = $createNodeSelection();

        $getRoot().append(block, $createParagraphNode().append($createTextNode("b")));
        selection.add(block.getKey());
        $setSelection(selection);
        $moveToEmptyLine();
      },
      { discrete: true },
    );

    expect(lines(editor)).toEqual(["a", "", "b"]);
  });
});
