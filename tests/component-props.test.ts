import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineComponent } from "@/config";
import type { ImageMetadata } from "astro";
import { propsResolver, type InferComponentProps } from "@/shared/component-props";

const components = {
  Section: defineComponent({
    props: z.object({ tone: z.enum(["base", "raised"]).default("base"), title: z.string() }),
    component: "@/components/Section.astro",
  }),
  Steps: defineComponent({
    component: "@/components/Steps.astro",
    children: {
      Step: defineComponent({
        props: ({ link }) => z.object({ href: link().default("/") }),
        component: "@/components/Step.astro",
      }),
    },
  }),
  Gallery: defineComponent({
    props: ({ image }) =>
      z.object({
        cover: image().optional(),
        images: z.array(z.object({ src: image(), alt: z.string() })),
      }),
    component: "@/components/Gallery.astro",
  }),
};

// MDX hands a component its attributes verbatim, so the wrappers apply the schema's defaults.
describe("propsResolver", () => {
  const resolveProps = propsResolver(components, async (path) => `https://cdn.test${path}`);

  it("applies defaults, children included, and keeps attributes the schema does not declare", async () => {
    expect(await resolveProps("Section", { title: "Hi", class: "wide" })).toEqual({
      tone: "base",
      title: "Hi",
      class: "wide",
    });
    expect(await resolveProps("Step", {})).toEqual({ href: "/" });
  });

  it("resolves every image, however deeply it is nested", async () => {
    expect(await resolveProps("Gallery", { images: [{ src: "/a.png", alt: "A" }] })).toEqual({
      images: [{ src: "https://cdn.test/a.png", alt: "A" }],
    });
  });

  it("names the component whose props are invalid", async () => {
    await expect(resolveProps("Section", { title: 1 })).rejects.toThrow(
      /Invalid props for Section/,
    );
  });

  it("types the props as rendered, and as MDX writes them", () => {
    type Output = InferComponentProps<typeof components>;
    type Input = InferComponentProps<typeof components, "input">;

    expectTypeOf<Output["Section"]>().toEqualTypeOf<{ tone: "base" | "raised"; title: string }>();
    expectTypeOf<Output["Step"]>().toEqualTypeOf<{ href: string }>();
    expectTypeOf<Input["Section"]>().toEqualTypeOf<{
      tone?: "base" | "raised" | undefined;
      title: string;
    }>();
    expectTypeOf<Input["Gallery"]["images"][number]["src"]>().toEqualTypeOf<string>();
    expectTypeOf<Output["Gallery"]>().toEqualTypeOf<{
      cover?: ImageMetadata | string | undefined;
      images: { src: ImageMetadata | string; alt: string }[];
    }>();
  });

  it("gives a component without props none, so a site can add its own", () => {
    type Output = InferComponentProps<typeof components>;

    expectTypeOf({ level: 2 as const }).toExtend<Output["Steps"] & { level?: 2 | 3 }>();
  });
});
