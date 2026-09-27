import { expect, it } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { registerHistory } from "@lexical/history";
import {
  claimHistory,
  clearPageHistory,
  historicUpdate,
  pageHistory,
  registerSkipUnchanged,
} from "@/client/lib/page-history";
import { newEditor } from "./fixtures/editor";

const setText = (value: string) => () =>
  $getRoot().clear().append($createParagraphNode().append($createTextNode(value)));

const texts = (...editors: LexicalEditor[]) => editors.map((editor) => editor.read(() => $getRoot().getTextContent()));

// Two editors sharing the page's history, as MDXEditor's body and a nested editor do.
function sharingEditors(): [LexicalEditor, LexicalEditor] {
  const sharing = () => {
    const editor = newEditor();

    registerHistory(editor, pageHistory, 300);
    registerSkipUnchanged(editor);

    return editor;
  };

  clearPageHistory();

  return [sharing(), sharing()];
}

it("undoes a change made from outside an editor in order with those of another editor", () => {
  const [nested, body] = sharingEditors();

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

it("undoes an insert into an editor that another one had the history's place of", () => {
  const [nested, body] = sharingEditors();

  body.update(setText("b0"), { discrete: true });
  // Discarding the changes clears the history, while the editors keep their states.
  clearPageHistory();
  nested.update(setText("n1"), { discrete: true });
  claimHistory(body);
  body.update(setText("b1"), { discrete: true });

  body.dispatchCommand(UNDO_COMMAND, undefined);
  expect(texts(nested, body)).toEqual(["n1", "b0"]);
});
