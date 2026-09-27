import { defineComponent, image, type InferComponentProps } from "astronaut-cms/config";
import { z } from "zod";
import {
  MessageSquareWarning,
  CreditCard,
  LayoutGrid,
  ListOrdered,
  FolderTree,
  Columns2,
  ExternalLink,
  Image as ImageIcon,
} from "lucide-react";

export const components = {
  Figure: defineComponent({
    props: z.object({
      src: image(),
      alt: z.string(),
      caption: z.string().optional(),
    }),
    source: "@/components/Figure.astro",
    defaultExport: true,
    label: "Figure",
    icon: ImageIcon,
  }),
  Aside: defineComponent({
      props: z.object({
        type: z.enum(["note", "tip", "caution", "danger"]).default("note"),
        title: z.string().optional(),
      }),
      children: "markdown",
      label: "Aside",
      icon: MessageSquareWarning,
    }),
    Card: defineComponent({
      props: z.object({
        title: z.string(),
      }),
      children: "markdown",
      label: "Card",
      icon: CreditCard,
    }),
    CardGrid: defineComponent({
      props: z.object({
        stagger: z.boolean().default(false),
      }),
      children: {
        Card: defineComponent({
          props: z.object({
            title: z.string(),
          }),
          children: "markdown",
          label: "Card",
          icon: CreditCard,
        }),
        LinkCard: defineComponent({
          props: z.object({
            title: z.string(),
            href: z.string(),
            description: z.string().optional(),
          }),
          label: "Link Card",
          icon: ExternalLink,
        }),
      },
      label: "Card Grid",
      icon: LayoutGrid,
    }),
    Steps: defineComponent({
      props: z.object({}),
      children: {
        StepItem: defineComponent({
          props: z.object({
            title: z.string(),
          }),
          children: "markdown",
          label: "Step Item",
          icon: ListOrdered,
        }),
      },
      label: "Steps",
      icon: ListOrdered,
    }),
    FileTree: defineComponent({
      props: z.object({}),
      children: "markdown",
      label: "File Tree",
      icon: FolderTree,
    }),
    Tabs: defineComponent({
      props: z.object({
        syncKey: z.string().optional(),
      }),
      children: {
        TabItem: defineComponent({
          props: z.object({
            label: z.string(),
          }),
          children: "markdown",
          label: "Tab Item",
          icon: Columns2,
        }),
      },
      label: "Tabs",
      icon: Columns2,
    }),
};

export type ComponentProps = InferComponentProps<typeof components>;
