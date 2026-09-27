import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { dts } from "rolldown-plugin-dts";
import pkg from "./package.json" with { type: "json" };

const src = (path: string) => resolve(import.meta.dirname, "src", path);

/** Whether an import stays out of a bundle that shares `packages` with the site. */
const externalTo =
  (packages: string[]) =>
  (id: string): boolean =>
    id.startsWith("virtual:") ||
    id.startsWith("astro:") ||
    packages.some((name) => id === name || id.startsWith(`${name}/`));

// Two bundles, each with every dependency compiled in, so a site installs and
// rebuilds none of them. The server shares the peers with the site. The admin
// shares only React, which the site's editors render inside it. Its zod is
// private, since the site's schemas are lowered on the site's own copy.
export default defineConfig({
  base: "./",
  // The declarations the dts plugin emits are modules too, and not for stripping.
  oxc: { exclude: /\.(js|d\.ts)$/ },
  resolve: {
    alias: [
      { find: "@", replacement: src("") },
      // CommonJS `acorn-jsx` would otherwise pull in acorn's CommonJS build beside
      // the ES one micromark imports, the same parser twice.
      { find: /^acorn$/, replacement: fileURLToPath(import.meta.resolve("acorn")) },
      // Slimmer stand-ins for what the admin's dependencies import. Matched
      // exactly, so the shiki substitute can still reach shiki's core.
      { find: /^shiki$/, replacement: src("client/bundle/shiki.ts") },
      { find: /^@codemirror\/language-data$/, replacement: src("client/bundle/codemirror-languages.ts") },
      {
        find: /^(@streamdown\/(math|mermaid)|rehype-raw)$/,
        replacement: src("client/bundle/disabled-plugin.ts"),
      },
    ],
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: src("client/routes"),
      generatedRouteTree: src("client/routeTree.gen.ts"),
      semicolons: true,
      quoteStyle: "double",
    }),
  ],
  builder: {},
  environments: {
    server: {
      consumer: "server",
      // Everything but the peers is bundled, for Node and Workers alike.
      resolve: { noExternal: true, conditions: ["module", "worker", "development|production"] },
      build: {
        outDir: "dist/server",
        lib: {
          entry: {
            integration: src("integration/index.ts"),
            config: src("config.ts"),
            assets: src("assets/index.ts"),
            content: src("content/index.ts"),
            internal: src("internal/index.ts"),
            endpoint: src("server/endpoint.ts"),
            "server-local": src("server/storage/local.ts"),
          },
          formats: ["es"],
        },
        rolldownOptions: {
          // One declaration file beside each entry, with every type it needs inlined.
          plugins: [dts()],
          external: externalTo(Object.keys(pkg.peerDependencies)),
          output: { chunkFileNames: "chunks/[name]-[hash].js" },
        },
      },
    },
    // Named `client`, the environment Vite always builds.
    client: {
      build: {
        outDir: "dist/admin",
        copyPublicDir: false,
        rolldownOptions: {
          input: {
            bootstrap: src("client/bootstrap.ts"),
            editor: src("editor.ts"),
            styles: src("astro/styles.css"),
          },
          // An app build rather than a library one, which would inline every font.
          preserveEntrySignatures: "strict",
          plugins: [dts()],
          external: externalTo(["react", "react-dom"]),
          output: {
            entryFileNames: "[name].js",
            // The stylesheet is an entry, so it keeps its name like the scripts do.
            assetFileNames: ({ names }) =>
              names.includes("styles.css") ? "[name][extname]" : "assets/[name]-[hash][extname]",
          },
        },
      },
    },
  },
});
