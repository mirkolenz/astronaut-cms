/**
 * What the admin build resolves `@streamdown/math`, `@streamdown/mermaid` and
 * `rehype-raw` to. KaTeX, Mermaid and an HTML parser would multiply the
 * assistant's size for what editing site content rarely needs, so math and
 * diagrams stay source text and raw HTML in a reply is dropped.
 */
export const math = undefined;
export const mermaid = undefined;

export default function rehypeRaw(): void {}
