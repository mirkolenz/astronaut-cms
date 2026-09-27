import { describe, expect, it } from "vitest";
import { validateBody } from "@/shared/body-validation";
import { components } from "./fixtures/user-config";

// Asset props on MDX components are plain strings in the schema, so a model can
// satisfy the tool's JSON Schema while pointing at an image that does not exist.
// The parser has to surface them for the caller to resolve against storage.
describe("validateBody", () => {
  it("reports asset props so their targets can be checked", () => {
    const { diagnostics, leaves } = validateBody(
      '<Figure src="/src/assets/hero.png" alt="Hero" />',
      "mdx",
      components,
    );

    expect(diagnostics).toEqual([]);
    expect(leaves).toEqual([
      { kind: "image", value: "/src/assets/hero.png", path: '<Figure> prop "src"' },
    ]);
  });

  // A build bundles only what this reports, so a child component's image has to
  // be found as surely as a top-level one's.
  it("reports asset props of nested child components", () => {
    const { diagnostics, leaves } = validateBody(
      '<Gallery>\n  <Tile src="/src/assets/tile.png" alt="Tile" />\n</Gallery>',
      "mdx",
      components,
    );

    expect(diagnostics).toEqual([]);
    expect(leaves).toEqual([
      { kind: "image", value: "/src/assets/tile.png", path: '<Tile> prop "src"' },
    ]);
  });

  // A braced prop is JavaScript, not JSON, so a single-quoted string is valid
  // and has to resolve like the quoted form: the build bundles what this reports.
  it("reads a statically-known expression prop", () => {
    const { diagnostics, leaves } = validateBody(
      "<Figure src={'/src/assets/hero.png'} alt={`Hero`} />",
      "mdx",
      components,
    );

    expect(diagnostics).toEqual([]);
    expect(leaves).toEqual([
      { kind: "image", value: "/src/assets/hero.png", path: '<Figure> prop "src"' },
    ]);
  });

  it("refuses a prop only a runtime can produce", () => {
    const { diagnostics, leaves } = validateBody(
      "<Figure src={hero} alt={`Hero ${n}`} />",
      "mdx",
      components,
    );

    expect(diagnostics).toHaveLength(2);
    expect(leaves).toEqual([]);
  });

  // The build compiles a body into a module and runs it, so anything beyond a
  // registered import and static props would be code a content write smuggles in.
  it("allows only registered imports, class wrappers and safe URLs", () => {
    const allowed = [
      'import Figure from "@/components/Figure.astro";\n\n{/* note */}\n\n<Figure src="/src/assets/hero.png" alt="Hero" />',
      '<div class="grid gap-4">\n\n[docs](/docs) and <span class="font-bold">[mail](mailto:a@b.c)</span>\n\n</div>',
    ];
    const refused = [
      'import fs from "node:fs";',
      "export const x = await fetch('https://evil.example');",
      "{process.env.SECRET}",
      "Inline {globalThis.x} expression.",
      '<Figure src="/src/assets/hero.png" alt="Hero" {...props} />',
      '<div onClick={() => fetch("https://evil.example")} />',
      '<div onclick="alert(1)">x</div>',
      "<script>alert(1)</script>",
      '<iframe src="https://evil.example" />',
      '<Figure src="/src/assets/hero.png" alt="Hero" set:html="<script>alert(1)</script>" />',
      "[x](javascript:alert(1))",
      "[x](<java\tscript:alert(1)>)",
    ];

    for (const body of allowed) {
      expect(validateBody(body, "mdx", components).diagnostics).toEqual([]);
    }

    for (const body of refused) {
      expect(validateBody(body, "mdx", components).diagnostics).not.toEqual([]);
    }
  });

  it("still reports schema violations in props", () => {
    const { diagnostics } = validateBody('<Figure src="/src/assets/hero.png" />', "mdx", components);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('missing required prop "alt"');
  });
});

// A Markdown body renders raw HTML as is, so it gets no HTML at all.
describe("validateBody on markdown", () => {
  it("refuses raw HTML and unsafe URLs", () => {
    expect(validateBody("[x](https://example.com)", "md", components).diagnostics).toEqual([]);
    expect(validateBody("<script>alert(1)</script>", "md", components).diagnostics).toHaveLength(1);
    expect(validateBody("[x]: javascript:alert(1)\n\n[y][x]", "md", components).diagnostics).toHaveLength(1);
  });
});
