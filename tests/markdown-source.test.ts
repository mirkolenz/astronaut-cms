import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { createSourcePreserver } from "@/client/lib/markdown-source";

const preserveSource = createSourcePreserver(fromMarkdown);

describe("createSourcePreserver", () => {
  it("keeps the text and spacing of unedited blocks", () => {
    const source = "*a*\n\n\n* x\n* y\n\nold";

    expect(preserveSource(source, "_a_\n\n- x\n- y\n\nnew")).toBe("*a*\n\n\n* x\n* y\n\nnew");
  });

  it("keeps the text of a moved block", () => {
    expect(preserveSource("*a*\n\n__b__", "**b**\n\n_a_")).toBe("__b__\n\n*a*");
  });

  it("falls back to the canonical text when new neighbors would merge", () => {
    expect(preserveSource("- a\n\ntext\n\n- b", "- a\n\n* b")).toBe("- a\n\n* b");
  });
});
