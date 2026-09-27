import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineComponent } from "../src/config.ts";
import { processUserConfig } from "../src/internal/user-config.ts";

// A component declares its props either directly or as a function handed the
// asset helpers, the same two forms astro's collection `schema` takes. Both have
// to lower to the same FieldSchema, since everything downstream — the form
// renderer, the MDX walk, the build's asset collection — reads only that.
describe("processUserConfig", () => {
  it("lowers both props forms, and only the helpers can name an asset", () => {
    const manifest = processUserConfig({
      Figure: defineComponent({
        props: ({ image, file }) =>
          z.object({ src: image(), doc: file().optional(), alt: z.string() }),
      }),
      Quote: defineComponent({
        props: z.object({ text: z.string() }),
      }),
    });

    expect(manifest.Figure?.props).toEqual({
      type: "object",
      shape: {
        src: { type: "image" },
        doc: { type: "file", optional: true },
        alt: { type: "string" },
      },
    });

    expect(manifest.Quote?.props).toEqual({
      type: "object",
      shape: { text: { type: "string" } },
    });
  });

  it("lowers a nested child component the same way", () => {
    const manifest = processUserConfig({
      Grid: defineComponent({
        props: z.object({ title: z.string() }),
        children: {
          Cell: defineComponent({ props: ({ image }) => z.object({ src: image() }) }),
        },
      }),
    });

    const children = manifest.Grid?.children;

    expect(typeof children === "object" && children.Cell?.props).toEqual({
      type: "object",
      shape: { src: { type: "image" } },
    });
  });
});
