import { expect, it } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  REDO_COMMAND,
  UNDO_COMMAND,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { registerHistory } from "@lexical/history";
import { historicUpdate, pageHistory, registerSkipUnchanged } from "@/client/lib/page-history";

const setText = (value: string) => () =>
  $getRoot().clear().append($createParagraphNode().append($createTextNode(value)));

const texts = (...editors: LexicalEditor[]) => editors.map((editor) => editor.read(() => $getRoot().getTextContent()));

it("undoes a change made from outside an editor in order with those of another editor", () => {
  // Two editors sharing the page's history, as MDXEditor's body and a nested editor do.
  const [nested, body] = [0, 1].map(() => {
    const editor = createEditor({
      onError: (error) => {
        throw error;
      },
    });

    registerHistory(editor, pageHistory, 300);
    registerSkipUnchanged(editor);

    return editor;
  }) as [LexicalEditor, LexicalEditor];

  body.update(setText("b0"), { discrete: true });
  nested.update(setText("n1"), { discrete: true });
  nested.update(setText("n2"), { discrete: true });
  historicUpdate(body, setText("b1"));

  body.dispatchCommand(UNDO_COMMAND, undefined);
  expect(texts(nested, body)).toEqual(["n2", "b0"]);

  body.dispatchCommand(UNDO_COMMAND, undefined);
  expect(texts(nested, body)).toEqual(["n1", "b0"]);

  body.dispatchCommand(REDO_COMMAND, undefined);
  body.dispatchCommand(REDO_COMMAND, undefined);
  expect(texts(nested, body)).toEqual(["n2", "b1"]);
});
