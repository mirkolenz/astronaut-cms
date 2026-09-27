import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import dts from "unplugin-dts/vite";
import { CLIENT_SOURCES } from "./src/entry-points.ts";
import { aliases, externalTo, libEntries, peers } from "./vite.shared.ts";

// Everything but the admin's browser bundle, which `vite.admin.config.ts`
// builds. The two share no module at runtime, so neither needs the other's
// chunks.
export default defineConfig({
  resolve: {
    alias: aliases,
    // The bundled dependencies run wherever the site's server does, Node or
    // Workers, and at build time in Node. A `worker` build is the portable one,
    // where a `browser` build may reach for the DOM.
    conditions: ["module", "worker", "development|production"],
  },
  plugins: [
    dts({ entryRoot: "src", exclude: [`src/${CLIENT_SOURCES}`] }),
    {
      name: "copy-astro-files",
      closeBundle() {
        // The stylesheet is compiled by `vite.styles.config.ts` instead.
        cpSync("src/astro", "dist/astro", {
          recursive: true,
          filter: (source) => !source.endsWith(".css"),
        });
      },
    },
  ],
  build: {
    lib: {
      entry: libEntries(false),
      formats: ["es"],
    },
    rolldownOptions: {
      external: externalTo(peers),
      output: {
        chunkFileNames: "shared.js",
      },
    },
  },
});
