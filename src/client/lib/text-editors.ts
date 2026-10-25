/**
 * The text editor an element is in, the editable text of Lexical or CodeMirror,
 * or null outside one and in the non-editable chrome of a block inside one.
 */
export function textEditorAt(element: Element): Element | null {
  const editor = element.closest(".cm-editor, [contenteditable]");

  return editor?.matches('.cm-editor, [contenteditable="true"]') ? editor : null;
}
