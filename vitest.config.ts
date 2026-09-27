import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const path = (...segments: string[]) => resolve(import.meta.dirname, ...segments);

// Standalone rather than the build config, so tests skip its plugins. The
// integration generates the virtual modules, so tests resolve them to fixtures.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path("src") },
      ...["server", "runtime", "order", "user-config"].map((name) => ({
        find: `virtual:astronaut-cms/${name}`,
        replacement: path("tests/fixtures", `${name}.ts`),
      })),
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
