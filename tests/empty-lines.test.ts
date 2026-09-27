import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { pruneEmptyLines } from "@/client/lib/empty-lines";

const lines = (editor: LexicalEditor) =>
  editor.read(() => $getRoot().getChildren().map((node) => node.getTextContent()));

describe("pruneEmptyLines", () => {
  it("removes the empty lines the caret has left", () => {
    const editor = createEditor({
      onError: (error) => {
        throw error;
      },
    });

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
});
