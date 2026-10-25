import { describe, expect, it } from "vitest";
import { collectResolvableLeaves } from "@/shared/resolvable-leaves";
import type { FieldSchema } from "@/shared/field-schema";

// The reference/asset integrity check walks (schema, value) in tandem. These pin
// that it finds every resolvable leaf at any nesting depth with a readable path,
// and ignores empty / missing values.

const schema: FieldSchema = {
  type: "object",
  shape: {
    title: { type: "string" },
    cover: { type: "image" },
    author: { type: "reference", collection: "authors" },
    related: { type: "array", element: { type: "reference", collection: "posts" } },
    seo: { type: "object", shape: { ogImage: { type: "file" } } },
  },
};

describe("collectResolvableLeaves", () => {
  it("collects references and assets at any depth with dotted paths", () => {
    const leaves = collectResolvableLeaves(schema, {
      title: "Hi",
      cover: "/img/a.png",
      author: "jane",
      related: ["p1", "p2"],
      seo: { ogImage: "/files/x.pdf" },
    });

    expect(leaves).toEqual([
      { kind: "image", value: "/img/a.png", path: "cover" },
      { kind: "reference", collection: "authors", value: "jane", path: "author" },
      { kind: "reference", collection: "posts", value: "p1", path: "related[0]" },
      { kind: "reference", collection: "posts", value: "p2", path: "related[1]" },
      { kind: "file", value: "/files/x.pdf", path: "seo.ogImage" },
    ]);
  });

  it("skips empty and missing values", () => {
    expect(collectResolvableLeaves(schema, { author: "", cover: null })).toEqual([]);
  });

  it("follows the matching branch of a plain union", () => {
    const variant: FieldSchema = {
      type: "union",
      variants: [
        { type: "object", shape: { image: { type: "image" } } },
        { type: "object", shape: { document: { type: "file" } } },
      ],
    };

    expect(collectResolvableLeaves(variant, { document: "/files/guide.pdf" })).toEqual([
      { kind: "file", value: "/files/guide.pdf", path: "document" },
    ]);
  });

  it("follows a discriminated branch with an enum tag", () => {
    const variant: FieldSchema = {
      type: "union",
      discriminator: "kind",
      variants: [
        {
          type: "object",
          shape: {
            kind: { type: "enum", options: ["photo", "drawing"] },
            asset: { type: "image" },
          },
        },
        {
          type: "object",
          shape: { kind: { type: "literal", value: "document" }, asset: { type: "file" } },
        },
      ],
    };

    expect(collectResolvableLeaves(variant, { kind: "drawing", asset: "/img/sketch.png" })).toEqual(
      [{ kind: "image", value: "/img/sketch.png", path: "asset" }],
    );
  });
});
