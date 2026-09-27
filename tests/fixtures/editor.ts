import { createEditor, type LexicalEditor } from "lexical";

// A headless editor that fails the test on any error.
export const newEditor = (): LexicalEditor =>
  createEditor({
    onError: (error) => {
      throw error;
    },
  });
