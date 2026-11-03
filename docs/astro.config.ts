import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Pure documentation site. The live CMS integration lives in the `demo`
// workspace now, which is the canonical showcase.
export default defineConfig({
  site: "https://mirkolenz.github.io",
  base: "/astronaut-cms",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Astronaut CMS",
      disable404Route: true,
      logo: {
        src: "../src/brand/logo.png",
      },
      favicon: "/favicon.png",
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
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});
