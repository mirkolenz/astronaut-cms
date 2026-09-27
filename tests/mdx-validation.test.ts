import { describe, expect, it } from "vitest";
import { validateMdx } from "@shared/mdx-validation";
import { components } from "./fixtures/user-config";

// Asset props on MDX components are plain strings in the schema, so a model can
// satisfy the tool's JSON Schema while pointing at an image that does not exist.
// The parser has to surface them for the caller to resolve against storage.
describe("validateMdx", () => {
  it("reports asset props so their targets can be checked", () => {
    const { diagnostics, leaves } = validateMdx(
      '<Figure src="/src/assets/hero.png" alt="Hero" />',
      "mdx",
      components,
    );

    expect(diagnostics).toEqual([]);
    expect(leaves).toEqual([
      { kind: "image", value: "/src/assets/hero.png", path: '<Figure> prop "src"' },
    ]);
  });

  it("still reports schema violations in props", () => {
    const { diagnostics } = validateMdx(
      '<Figure src="/src/assets/hero.png" />',
      "mdx",
      components,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('missing required prop "alt"');
  });
});
