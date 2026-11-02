import { expect, it } from "vitest";
import { z } from "zod";
import { checkAnchors } from "@/shared/anchors";
import { validateBody } from "@/shared/body-validation";
import { schemaHelpers } from "@/shared/cms-markers";
import type { ComponentSchemaMap } from "@/shared/field-schema";
import { dataLeaves } from "@/shared/resolvable-leaves";
import { zodToFieldSchema } from "@/shared/zod-to-field";

const { anchor, link } = schemaHelpers(async (path) => path);

const components: ComponentSchemaMap = {
  Section: { props: zodToFieldSchema(z.object({ id: anchor().optional() })), children: "markdown" },
  Button: { props: zodToFieldSchema(z.object({ url: link() })) },
};

it("checks links to #id against the anchors of the entry, each defined once", () => {
  const body = [
    '<Section id="contact">',
    "## Opening hours",
    '<Button url="#contact" />',
    "</Section>",
    "",
    "[Hours](#opening-hours) [Top](#top) [Elsewhere](/about/#team) [Typo](#contakt)",
  ].join("\n");
  const schema = zodToFieldSchema(z.object({ cta: link(), section: anchor() }));
  const parsed = validateBody(body, "mdx", components);
  const diagnostics = checkAnchors([
    ...dataLeaves(schema, { cta: "#missing", section: "contact" }),
    ...parsed.leaves,
  ]);

  expect(parsed.diagnostics).toEqual([]);
  expect(diagnostics.map((d) => d.path)).toEqual(['<Section> prop "id"', "cta", "Markdown link"]);
  expect(diagnostics[2]?.message).toContain("#contact, #opening-hours");
});

it("declares an id without #, keeping the site's own constraints", () => {
  expect(anchor().safeParse("#contact").success).toBe(false);
  expect(zodToFieldSchema(anchor().regex(/^[a-z]+$/))).toEqual({
    type: "string",
    format: "anchor",
    pattern: "^[a-z]+$",
  });
});
