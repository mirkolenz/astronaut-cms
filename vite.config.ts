import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { dts } from "rolldown-plugin-dts";
import pkg from "./package.json" with { type: "json" };
import { dependencyPolicy, environmentAliases, licenseExtras } from "./vite.plugins.ts";

const src = (path: string) => resolve(import.meta.dirname, "src", path);

const licenses = licenseExtras(pkg.name, "THIRD_PARTY_LICENSES.md");

// The server compiles in no third-party code and may import only the declared
// dependencies. The admin is one bundle with everything compiled in but React,
// which the site's editors render inside it. See the security guide.
export default defineConfig({
  base: "./",
  // The declarations the dts plugin emits are modules too, and not for stripping.
  oxc: { exclude: /\.(js|d\.ts)$/ },
  resolve: { tsconfigPaths: true },
  plugins: [
    environmentAliases("client", {
      // CommonJS `acorn-jsx` would otherwise pull in acorn's CommonJS build beside
      // the ES one micromark imports, the same parser twice.
      acorn: fileURLToPath(import.meta.resolve("acorn")),
      // Slimmer stand-ins for what the admin's dependencies import.
      shiki: src("client/bundle/shiki.ts"),
      "@codemirror/language-data": src("client/bundle/codemirror-languages.ts"),
      "rehype-raw": src("client/bundle/disabled-plugin.ts"),
    }),
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
  // Self-contained, since each is loaded on its own from a blob (see `extractInWorker`).
  worker: {
    format: "es",
    rolldownOptions: { output: { codeSplitting: false } },
  },
  builder: {},
  environments: {
    server: {
      consumer: "server",
      // Vite externalizes nothing itself, so `dependencyPolicy` alone decides.
      resolve: { noExternal: true },
      build: {
        outDir: "dist/server",
        // The site's own build lowers it for its runtime.
        target: "esnext",
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
          // One declaration file beside each entry.
          plugins: [
            dependencyPolicy({
              self: pkg.name,
              external: Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }),
              strict: true,
            }),
            dts(),
          ],
          output: { chunkFileNames: "chunks/[name]-[hash].js" },
        },
      },
    },
    // An app build rather than a library one, which would inline every font.
    styles: {
      consumer: "client",
      build: {
        outDir: "dist/styles",
        copyPublicDir: false,
        license: licenses.option,
        rolldownOptions: {
          input: { styles: src("astro/styles.css") },
          plugins: [licenses.plugin],
          output: {
            assetFileNames: ({ names }) =>
              names.includes("styles.css") ? "[name][extname]" : "assets/[name]-[hash][extname]",
          },
        },
      },
    },
    // Named `client`, the environment Vite always builds. A library build, since the
    // site bundles it again, which leaves preloading its chunks to the site's build.
    client: {
      build: {
        outDir: "dist/admin",
        copyPublicDir: false,
        // The licenses of the packages compiled in, which their terms require to travel with them.
        license: licenses.option,
        lib: {
          entry: {
            bootstrap: src("client/bootstrap.ts"),
            editor: src("client/editor.ts"),
          },
          formats: ["es"],
        },
        rolldownOptions: {
          // React's `"use client"` only matters to server components, which the admin has none of.
          checks: { moduleLevelDirective: false },
          // Worker builds take these too, where the license plugin lists their packages.
          plugins: [
            // React is the site's, and the editor's declarations use the mdast types
            // the server's already depend on.
            dependencyPolicy({ self: pkg.name, external: ["react", "react-dom", "@types/mdast"] }),
            // Only what a site imports is declared, not every module the admin reaches.
            dts({ entry: ["src/client/editor.ts", "src/client/bootstrap.ts"] }),
            licenses.plugin,
          ],
          output: {
            // Vite keeps a library's whitespace, which a bundle nobody reads only pays for.
            minify: true,
            chunkFileNames: "assets/[name]-[hash].js",
          },
        },
      },
    },
  },
});
