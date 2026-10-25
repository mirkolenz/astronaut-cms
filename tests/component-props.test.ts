import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineComponent } from "../src/config.ts";
import { propsResolver, type InferComponentProps } from "../src/shared/component-props.ts";

const components = {
  Section: defineComponent({
    props: z.object({ tone: z.enum(["base", "raised"]).default("base"), title: z.string() }),
    component: "@/components/Section.astro",
  }),
  Steps: defineComponent({
    props: z.object({}),
    component: "@/components/Steps.astro",
    children: {
      Step: defineComponent({
        props: ({ link }) => z.object({ href: link().default("/") }),
        component: "@/components/Step.astro",
      }),
    },
  }),
};

// MDX hands a component its attributes verbatim, so the wrappers apply the schema's defaults.
describe("propsResolver", () => {
  const resolveProps = propsResolver(components);

  it("applies defaults, children included, and keeps attributes the schema does not declare", () => {
    expect(resolveProps("Section", { title: "Hi", class: "wide" })).toEqual({
      tone: "base",
      title: "Hi",
      class: "wide",
    });
    expect(resolveProps("Step", {})).toEqual({ href: "/" });
  });

  it("names the component whose props are invalid", () => {
    expect(() => resolveProps("Section", { title: 1 })).toThrow(/Invalid props for Section/);
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
  });
});
