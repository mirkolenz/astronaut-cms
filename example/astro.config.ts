import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import cms from "astronaut-cms";

export default defineConfig({
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  vite: {
    resolve: {
      conditions: ["source"],
    },
  },
  integrations: [mdx(), react(), cms()],
});
