import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Standalone config (not the build config) so tests do not pull in the dts /
// router plugins. Aliases mirror tsconfig; `virtual:astronaut-cms/config` is a
// build-time modules, so tests resolve them to fixture stubs.
export default defineConfig({
  resolve: {
    alias: {
      "virtual:astronaut-cms/config": resolve(import.meta.dirname, "tests/fixtures/config.ts"),
      "virtual:astronaut-cms/collections": resolve(
        import.meta.dirname,
        "tests/fixtures/collections.ts",
      ),
      "virtual:astronaut-cms/user-config": resolve(
        import.meta.dirname,
        "tests/fixtures/user-config.ts",
      ),
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
