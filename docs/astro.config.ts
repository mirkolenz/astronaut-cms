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
      logo: {
        src: "../assets/logo.png",
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
    react(),
    cms({
      storage: {
        type: "github",
        repo: "mirkolenz/astronaut-cms",
        branch: "main",
        clientId: "Ov23liO6YlidLM2gkKBv",
      },
      // Enable the dev AI assistant only when AI_GATEWAY_URL points at a local
      // OpenAI-compatible server (e.g. llama.cpp's `llama-server`). AI_GATEWAY_MODEL
      // selects the model id it serves.
      ...(process.env.AI_GATEWAY_URL && {
        ai: {
          enabled: true,
          gateway: { type: "custom", baseUrl: process.env.AI_GATEWAY_URL },
          models: [process.env.AI_GATEWAY_MODEL ?? "local"],
        },
      }),
    }),
  ],
});
