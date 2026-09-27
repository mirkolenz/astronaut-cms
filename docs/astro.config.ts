import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import cms from "../src/integration/index.ts";

export default defineConfig({
  site: "https://mirkolenz.github.io",
  base: "/astronaut-cms",
  trailingSlash: "always",
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
    cms({
      storage: {
        type: "github",
        repo: "mirkolenz/astronaut-cms",
        branch: "main",
        clientId: "Ov23liO6YlidLM2gkKBv",
      },
    }),
  ],
});
