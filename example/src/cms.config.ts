import { defineConfig, defineComponent, image, file } from "astronaut-cms/config";
import { z } from "astro/zod";
import { TriangleAlert, Pin, FolderOpen, Image, Paperclip } from "lucide-react";

export default defineConfig({
  components: {
    Alert: defineComponent({
      props: z.object({
        type: z.enum(["info", "warning", "error"]).default("info"),
      }),
      children: "markdown",
      label: "Alert",
      icon: TriangleAlert,
    }),
    Callout: defineComponent({
      props: z.object({
        title: z.string(),
      }),
      children: "markdown",
      label: "Callout",
      icon: Pin,
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
      icon: FolderOpen,
    }),
    Hero: defineComponent({
      props: z.object({
        cover: image(),
        caption: z.string().optional(),
      }),
      children: "markdown",
      label: "Hero",
      icon: Image,
    }),
    Download: defineComponent({
      props: z.object({
        document: file(),
        label: z.string(),
      }),
      label: "Download",
      icon: Paperclip,
    }),
  },
});
