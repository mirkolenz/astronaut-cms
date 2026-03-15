export interface ToolbarAction {
  id?: string;
  label: string;
  icon: string;
  action: (textarea: HTMLTextAreaElement) => { value: string; selStart: number; selEnd: number };
}

export function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
): { value: string; selStart: number; selEnd: number } {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const newText = `${before}${selected || "text"}${after}`;
  const newValue = value.slice(0, selectionStart) + newText + value.slice(selectionEnd);
  return {
    value: newValue,
    selStart: selectionStart + before.length,
    selEnd: selectionStart + before.length + (selected || "text").length,
  };
}

export function prefixLines(
  textarea: HTMLTextAreaElement,
  prefix: string,
): { value: string; selStart: number; selEnd: number } {
  const { selectionStart, selectionEnd, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionEnd);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(lineStart, end);
  const prefixed = lines
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
  const newValue = value.slice(0, lineStart) + prefixed + value.slice(end);
  return {
    value: newValue,
    selStart: selectionStart + prefix.length,
    selEnd: selectionEnd + prefix.length * lines.split("\n").length,
  };
}

export const toolbarActions: ToolbarAction[] = [
  {
    label: "Bold",
    icon: "B",
    action: (ta) => wrapSelection(ta, "**", "**"),
  },
  {
    label: "Italic",
    icon: "I",
    action: (ta) => wrapSelection(ta, "_", "_"),
  },
  {
    label: "Code",
    icon: "<>",
    action: (ta) => wrapSelection(ta, "`", "`"),
  },
  {
    label: "Link",
    icon: "\u{1F517}",
    action: (ta) => wrapSelection(ta, "[", "](url)"),
  },
  {
    id: "image",
    label: "Image",
    icon: "\u{1F5BC}",
    action: (ta) => wrapSelection(ta, "![alt](", ")"),
  },
  {
    label: "H2",
    icon: "H2",
    action: (ta) => prefixLines(ta, "## "),
  },
  {
    label: "H3",
    icon: "H3",
    action: (ta) => prefixLines(ta, "### "),
  },
  {
    label: "List",
    icon: "\u{2022}",
    action: (ta) => prefixLines(ta, "- "),
  },
  {
    label: "Ordered",
    icon: "1.",
    action: (ta) => prefixLines(ta, "1. "),
  },
  {
    label: "Quote",
    icon: ">",
    action: (ta) => prefixLines(ta, "> "),
  },
  {
    label: "Code Block",
    icon: "```",
    action: (ta) => wrapSelection(ta, "```\n", "\n```"),
  },
];
