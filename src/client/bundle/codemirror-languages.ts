/**
 * What the admin build resolves `@codemirror/language-data` to, the languages
 * MDXEditor's code blocks highlight. The original lists well over a hundred,
 * most of them legacy modes a site's content never holds. A language missing
 * here edits as plain text.
 */
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import type { StreamParser } from "@codemirror/language";
// Static, since MDXEditor's source view already imports these four.
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

const legacy = (parser: StreamParser<unknown>): LanguageSupport =>
  new LanguageSupport(StreamLanguage.define(parser));

export const languages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xhtml"],
    extensions: ["html", "htm"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["ecmascript", "js", "node"],
    extensions: ["js", "mjs", "cjs"],
    load: async () => javascript(),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json5"],
    extensions: ["json"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "Markdown",
    extensions: ["md", "markdown", "mdx"],
    load: async () => markdown(),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh"],
    extensions: ["sh", "bash"],
    load: () => import("@codemirror/legacy-modes/mode/shell").then((m) => legacy(m.shell)),
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load: () => import("@codemirror/legacy-modes/mode/toml").then((m) => legacy(m.toml)),
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    load: async () => javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    load: async () => javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  }),
];
