import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import dts from "unplugin-dts/vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  resolve: {
    alias: {
      "@client": resolve(import.meta.dirname, "src/client"),
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@integration": resolve(import.meta.dirname, "src/integration"),
      "@assets": resolve(import.meta.dirname, "assets"),
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
    dts({ entryRoot: "src", exclude: ["src/client/**"] }),
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
        client: "src/client/index.tsx",
        runtime: "src/runtime/index.ts",
        "ai-endpoint": "src/runtime/ai-endpoint.ts",
        internal: "src/internal/index.ts",
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
        if (warning.code === "SOURCEMAP_ERROR") return;
        warn(warning);
      },
    },
  },
});
