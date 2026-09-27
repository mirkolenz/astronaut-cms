/**
 * What the admin build resolves `shiki` to: the same API over a handful of
 * grammars and two themes, on the JavaScript regex engine. The full bundle
 * ships every grammar shiki has and the Oniguruma WebAssembly, several
 * megabytes nobody editing a site's content needs. Each grammar still loads on
 * first use, and a language missing here renders as plain text.
 */
import { createBundledHighlighter, type BundledLanguageInfo } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const bundledLanguagesInfo: BundledLanguageInfo[] = [
  { id: "css", name: "CSS", import: () => import("shiki/langs/css.mjs") },
  { id: "diff", name: "Diff", import: () => import("shiki/langs/diff.mjs") },
  { id: "html", name: "HTML", import: () => import("shiki/langs/html.mjs") },
  { id: "json", name: "JSON", import: () => import("shiki/langs/json.mjs") },
  {
    id: "markdown",
    name: "Markdown",
    aliases: ["md"],
    import: () => import("shiki/langs/markdown.mjs"),
  },
  { id: "mdx", name: "MDX", import: () => import("shiki/langs/mdx.mjs") },
  {
    id: "shellscript",
    name: "Shell",
    aliases: ["bash", "sh", "shell", "zsh"],
    import: () => import("shiki/langs/shellscript.mjs"),
  },
  { id: "toml", name: "TOML", import: () => import("shiki/langs/toml.mjs") },
  // A superset of JavaScript, JSX and TypeScript, so one grammar serves all four.
  {
    id: "tsx",
    name: "TSX",
    aliases: ["javascript", "js", "cjs", "mjs", "jsx", "typescript", "ts", "cts", "mts"],
    import: () => import("shiki/langs/tsx.mjs"),
  },
  { id: "yaml", name: "YAML", aliases: ["yml"], import: () => import("shiki/langs/yaml.mjs") },
];

export const bundledLanguages = Object.fromEntries(
  bundledLanguagesInfo.map((info) => [info.id, info.import]),
);

export const bundledThemes = {
  "github-light": () => import("shiki/themes/github-light.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
};

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});
