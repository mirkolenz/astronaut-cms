import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import cms from "astronaut-cms";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://mirkolenz.github.io",
  base: process.env.BASE_PATH ?? "/astronaut-cms",
  vite: {
    resolve: {
      conditions: ["source"],
    },
  },
  integrations: [
    starlight({
      title: "Astronaut CMS",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/mirkolenz/astronaut-cms",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/mirkolenz/astronaut-cms/edit/main/docs/",
      },
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
    react(),
    cms(),
  ],
});
