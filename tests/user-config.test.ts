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

  it("reads a field's title, description and group from either side of its modifiers", () => {
    const manifest = processUserConfig({
      Hero: defineComponent({
        props: z.object({
          title: z.string().meta({ title: "Headline", group: "Text" }).optional(),
          href: z.string().optional().describe("Where it leads."),
        }),
      }),
    });

    expect(manifest.Hero?.props).toEqual({
      type: "object",
      shape: {
        title: { type: "string", optional: true, label: "Headline", group: "Text" },
        href: { type: "string", optional: true, description: "Where it leads." },
      },
    });
  });

  it("refuses two definitions under one name, but not one definition shared by two parents", () => {
    const Item = defineComponent({ props: z.object({ title: z.string() }) });

    expect(() =>
      processUserConfig({
        Tabs: defineComponent({ props: z.object({}), children: { Item } }),
        List: defineComponent({ props: z.object({}), children: { Item } }),
      }),
    ).not.toThrow();

    expect(() =>
      processUserConfig({
        Tabs: defineComponent({ props: z.object({}), children: { Item } }),
        Item: defineComponent({ props: z.object({ label: z.string() }) }),
      }),
    ).toThrow(/defined twice/);
  });
});
