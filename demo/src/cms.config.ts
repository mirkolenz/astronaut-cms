import {
  defineCollection,
  defineComponent,
  type InferComponentProps,
} from "astronaut-cms/config";
import { z } from "zod";
import {
  Sparkles,
  LayoutGrid,
  Star,
  MousePointerClick,
  Quote as QuoteIcon,
  Image as ImageIcon,
} from "lucide-react";

// A small, curated palette of blocks. Editors compose pages by inserting these
// and filling short forms, so the set stays intentionally tight: a hero, a
// feature grid, a call to action, a pull quote, and a captioned figure. Each
// block points at its rendering `.astro` component via `source`, so the editor
// wires up the import automatically.
//
// A block whose props name an asset or a link takes the function form and reads
// `image` / `file` / `link` off the helpers it is handed,
// exactly as a collection schema reads `image` off astro's.
// The rest declare their props directly.
export const components = {
  Hero: defineComponent({
    props: ({ image, link }) =>
      z.object({
        eyebrow: z.string().optional(),
        title: z.string(),
        subtitle: z.string().optional(),
        image: image().optional(),
        ctaText: z.string().optional().meta({ title: "Button text", group: "Button" }),
        ctaHref: link().optional().meta({ title: "Button link", group: "Button" }),
      }),
    source: "@/components/Hero.astro",
    defaultExport: true,
    label: "Hero",
    description: "A large page opener with a headline, an image and a button.",
    icon: Sparkles,
  }),

  FeatureGrid: defineComponent({
    props: z.object({
      title: z.string().optional(),
    }),
    children: {
      Feature: defineComponent({
        props: z.object({
          title: z.string(),
          icon: z.enum(["compass", "layers", "pen", "spark"]).default("compass"),
        }),
        children: "markdown",
        source: "@/components/Feature.astro",
        defaultExport: true,
        label: "Feature",
        icon: Star,
      }),
    },
    source: "@/components/FeatureGrid.astro",
    defaultExport: true,
    label: "Feature Grid",
    description: "A grid of features, each with an icon and a short text.",
    icon: LayoutGrid,
  }),

  CallToAction: defineComponent({
    props: ({ link }) =>
      z.object({
        title: z.string(),
        text: z.string().optional(),
        buttonText: z.string(),
        buttonHref: link(),
      }),
    source: "@/components/CallToAction.astro",
    defaultExport: true,
    label: "Call to Action",
    description: "A closing prompt with a button.",
    icon: MousePointerClick,
  }),

  Quote: defineComponent({
    props: z.object({
      text: z.string(),
      author: z.string(),
      role: z.string().optional(),
    }),
    source: "@/components/Quote.astro",
    defaultExport: true,
    label: "Quote",
    description: "A pull quote with its author.",
    icon: QuoteIcon,
  }),

  Figure: defineComponent({
    props: ({ image }) =>
      z.object({
        src: image(),
        alt: z.string(),
        caption: z.string().optional(),
      }),
    source: "@/components/Figure.astro",
    defaultExport: true,
    label: "Figure",
    description: "An image with a caption.",
    icon: ImageIcon,
  }),
};

export type ComponentProps = InferComponentProps<typeof components>;

// The team page lists members in the order of `src/data/team.json`.
export const collections = {
  team: defineCollection({ sort: "file" }),
};
