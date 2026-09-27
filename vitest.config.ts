import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const fixture = (name: string) => resolve(import.meta.dirname, "tests/fixtures", `${name}.ts`);

// Standalone rather than the build config, so tests skip its plugins. The
// integration generates the virtual modules, so tests resolve them to fixtures.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "src") },
      ...["config", "routing", "collections", "user-config", "server", "order", "local-storage"].map(
        (name) => ({ find: `virtual:astronaut-cms/${name}`, replacement: fixture(name) }),
      ),
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
