import type { LucideIcon } from "lucide-react";
import {
  Bold,
  Italic,
  Code,
  Link,
  Image,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
} from "lucide-react";

export interface ToolbarAction {
  id?: string;
  label: string;
  icon: LucideIcon;
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
    icon: Bold,
    action: (ta) => wrapSelection(ta, "**", "**"),
  },
  {
    label: "Italic",
    icon: Italic,
    action: (ta) => wrapSelection(ta, "_", "_"),
  },
  {
    label: "Code",
    icon: Code,
    action: (ta) => wrapSelection(ta, "`", "`"),
  },
  {
    label: "Link",
    icon: Link,
    action: (ta) => wrapSelection(ta, "[", "](url)"),
  },
  {
    id: "image",
    label: "Image",
    icon: Image,
    action: (ta) => wrapSelection(ta, "![alt](", ")"),
  },
  {
    label: "H2",
    icon: Heading2,
    action: (ta) => prefixLines(ta, "## "),
  },
  {
    label: "H3",
    icon: Heading3,
    action: (ta) => prefixLines(ta, "### "),
  },
  {
    label: "List",
    icon: List,
    action: (ta) => prefixLines(ta, "- "),
  },
  {
    label: "Ordered",
    icon: ListOrdered,
    action: (ta) => prefixLines(ta, "1. "),
  },
  {
    label: "Quote",
    icon: Quote,
    action: (ta) => prefixLines(ta, "> "),
  },
  {
    label: "Code Block",
    icon: SquareCode,
    action: (ta) => wrapSelection(ta, "```\n", "\n```"),
  },
];
