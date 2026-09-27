import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Standalone config (not the build config) so tests do not pull in the dts /
// router plugins. Aliases mirror tsconfig; `virtual:astronaut-cms/config` is a
// build-time module, so tests resolve it to a fixture stub.
export default defineConfig({
  resolve: {
    alias: {
      "virtual:astronaut-cms/config": resolve(import.meta.dirname, "tests/fixtures/config.ts"),
      "@client": resolve(import.meta.dirname, "src/client"),
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@integration": resolve(import.meta.dirname, "src/integration"),
      "@assets": resolve(import.meta.dirname, "assets"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
