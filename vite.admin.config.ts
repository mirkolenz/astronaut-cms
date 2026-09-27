import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { aliases, externalTo, libEntries } from "./vite.shared.ts";

const substitute = (path: string) => resolve(import.meta.dirname, "src/client/bundle", path);

// The admin, compiled with its dependencies so a site neither installs nor
// rebuilds them. Its entries share one graph, which is what makes the editor
// primitives `astronaut-cms/editor` hands a site the admin's own instance.
//
// React is all it shares with the site, whose editors render inside it. Zod is
// bundled: the site's schemas are lowered by `astronaut-cms/internal` on the
// site's own copy, so the admin's is private, and one copy then serves every
// subpath its dependencies import.
export default defineConfig({
  resolve: {
    alias: [
      ...aliases,
      // Matched exactly, so the substitute can still reach shiki's core.
      { find: /^shiki$/, replacement: substitute("shiki.ts") },
      { find: /^@streamdown\/(math|mermaid)$/, replacement: substitute("disabled-plugin.ts") },
      {
        find: /^@codemirror\/language-data$/,
        replacement: substitute("codemirror-languages.ts"),
      },
    ],
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
      semicolons: true,
      quoteStyle: "double",
    }),
  ],
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: process.env.ADMIN_SOURCEMAP === "1",
    lib: {
      entry: libEntries(true),
      formats: ["es"],
    },
    rolldownOptions: {
      external: externalTo(["react", "react-dom"]),
      output: {
        // Vite keeps a library's whitespace, which a bundle nobody reads only pays for.
        minify: true,
        chunkFileNames: "admin/[name]-[hash].js",
        assetFileNames: "admin/[name]-[hash][extname]",
      },
    },
  },
});
