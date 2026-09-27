import { cpSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import dts from "unplugin-dts/vite";
import { CLIENT_SOURCES, ENTRY_POINTS, bundleOf } from "./src/entry-points.ts";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));

const externalPackages = [
  ...builtinModules,
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const isExternal = (id: string) =>
  id.startsWith("virtual:") ||
  externalPackages.some(
    (name) => id === name || id === `node:${name}` || id.startsWith(`${name}/`),
  );

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
      semicolons: true,
      quoteStyle: "double",
    }),
    dts({ entryRoot: "src", exclude: [`src/${CLIENT_SOURCES}`] }),
    {
      name: "copy-astro-files",
      closeBundle() {
        cpSync("src/astro", "dist/astro", { recursive: true });
      },
    },
  ],
  build: {
    lib: {
      entry: Object.fromEntries(
        ENTRY_POINTS.map((entry) => [bundleOf(entry), `src/${entry.source}`]).filter(
          ([bundle]) => bundle !== null,
        ),
      ),
      formats: ["es"],
    },
    rolldownOptions: {
      external: isExternal,
      output: {
        chunkFileNames: "shared.js",
      },
    },
  },
});
