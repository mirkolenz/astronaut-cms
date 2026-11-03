import { join } from "pathe";
import { build } from "vite";
import { expect, it } from "vitest";
import { resolveClientConfig, resolveServerConfig } from "@/integration/resolve-config";
import { cmsVitePlugin } from "@/integration/vite-plugin";
import { project } from "@tests/fixtures/project";

const plugin = (root: string, userConfigPath: string | null = null) =>
  cmsVitePlugin({
    clientConfig: resolveClientConfig({}, undefined, null, {}),
    serverConfig: resolveServerConfig({}, root, null, "ignore"),
    userConfigPath,
    components: {},
    componentsEntry: join(root, "components.ts"),
    rootDir: root,
  });

it("loads a CMS config that exports collections without components", async () => {
  const root = project({
    "src/cms.config.ts": "export const collections = {};",
    "src/entry.ts":
      'import { components } from "virtual:astronaut-cms/user-config"; export default components;',
  });
  const result = await build({
    root,
    logLevel: "silent",
    resolve: {
      alias: {
        "astronaut-cms/internal": join(import.meta.dirname, "../src/internal/user-config.ts"),
      },
    },
    plugins: [plugin(root, join(root, "src/cms.config.ts"))],
    build: { lib: { entry: "src/entry.ts", formats: ["es"] }, write: false },
  });

  expect(result).toBeDefined();
});

it("stands in for the admin's editor primitives on the server", async () => {
  const root = project({
    "src/entry.ts": 'export { NestedLexicalEditor } from "astronaut-cms/editor";',
  });
  const result = await build({
    root,
    logLevel: "silent",
    resolve: {
      alias: {
        "astronaut-cms/internal": join(import.meta.dirname, "../src/internal/editor-stubs.ts"),
      },
    },
    plugins: [plugin(root)],
    build: { ssr: "src/entry.ts", write: false },
  });

  expect(JSON.stringify(result)).toContain("only runs in the admin");
});
