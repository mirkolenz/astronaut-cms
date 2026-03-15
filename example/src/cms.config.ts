import { defineConfig, defineComponent, image, file } from "astronaut-cms/config";
import { z } from "astro/zod";

export default defineConfig({
  components: {
    Alert: defineComponent({
      props: z.object({
        type: z.enum(["info", "warning", "error"]).default("info"),
      }),
      children: "markdown",
      label: "Alert",
      icon: "\u26A0\uFE0F",
    }),
    Callout: defineComponent({
      props: z.object({
        title: z.string(),
      }),
      children: "markdown",
      label: "Callout",
      icon: "\u{1F4CC}",
    }),
    Tabs: defineComponent({
      props: z.object({}),
      children: {
        Tab: defineComponent({
          props: z.object({ label: z.string() }),
          children: "markdown",
          label: "Tab",
        }),
      },
      label: "Tabs",
      icon: "\u{1F4C1}",
    }),
    Hero: defineComponent({
      props: z.object({
        cover: image(),
        caption: z.string().optional(),
      }),
      children: "markdown",
      label: "Hero",
      icon: "\u{1F5BC}\uFE0F",
    }),
    Download: defineComponent({
      props: z.object({
        document: file(),
        label: z.string(),
      }),
      label: "Download",
      icon: "\u{1F4CE}",
    }),
  },
});
