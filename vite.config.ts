import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
      semicolons: true,
      quoteStyle: "double",
    }),
    dts({ rollupTypes: true, exclude: ["src/client/**"] }),
    externalizeDeps({ include: [/^virtual:/] }),
    {
      name: "copy-astro-files",
      closeBundle() {
        cpSync("src/astro", "dist/astro", { recursive: true });
      },
    },
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        integration: "src/integration/index.ts",
        config: "src/config.ts",
        stubs: "src/stubs/index.ts",
        client: "src/client/index.tsx",
      },
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: {
      output: {
        chunkFileNames: "shared.js",
      },
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
