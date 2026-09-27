import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import cms from "../src/integration/index.ts";

// A deliberately minimal setup: the CMS auto-discovers the collections in
// `src/content.config.ts` and the block components in `src/cms.config.ts`, then
// serves a schema-driven admin panel at `/admin`. Local storage keeps the demo
// zero-config — `npm run dev` and open `/admin`, no OAuth required. Swap in a
// `{ type: "github", repo, clientId }` backend to publish edits as commits.
export default defineConfig({
  site: "https://example.com",
  integrations: [
    mdx(),
    react(),
    cms({
      storage: { type: "local" },
      // Agentic AI assistant, pointed at a local llama.cpp `llama-server`
      // (OpenAI-compatible at /v1). The browser runs the agent loop; only model
      // inference is proxied through the injected relay route. No API key is
      // needed for a local server; set ASTRONAUT_CMS_AI_API_KEY for a remote one.
      ai: {
        enabled: true,
        gateway: { type: "custom", baseUrl: "http://localhost:18000/v1" },
        models: ["qwen3.6-35b-a3b"],
      },
    }),
  ],
});
