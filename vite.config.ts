import { cpSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import dts from "unplugin-dts/vite";

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
    {
      name: "copy-astro-files",
      closeBundle() {
        cpSync("src/astro", "dist/astro", { recursive: true });
      },
    },
  ],
  build: {
    lib: {
      entry: {
        integration: "src/integration/index.ts",
        config: "src/config.ts",
        client: "src/client/index.tsx",
        assets: "src/assets/index.ts",
        "ai-endpoint": "src/ai/endpoint.ts",
        internal: "src/internal/index.ts",
      },
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
