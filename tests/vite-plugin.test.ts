import { join } from "pathe";
import { build } from "vite";
import { expect, it } from "vitest";
import { resolveClientConfig, resolveServerConfig } from "@/integration/resolve-config";
import { cmsVitePlugin } from "@/integration/vite-plugin";
import { project } from "./fixtures/project";

it("loads a CMS config that exports collections without components", async () => {
  const root = project({
    "src/cms.config.ts": "export const collections = {};",
    "src/entry.ts": 'import { components } from "virtual:astronaut-cms/user-config"; export default components;',
  });
  const result = await build({
    root,
    logLevel: "silent",
    resolve: {
      alias: {
        "astronaut-cms/internal": join(import.meta.dirname, "../src/internal/user-config.ts"),
      },
    },
    plugins: [
      cmsVitePlugin({
        clientConfig: resolveClientConfig({}, undefined, null, {}),
        serverConfig: resolveServerConfig({}, root, null, "ignore"),
        userConfigPath: join(root, "src/cms.config.ts"),
        components: {},
        rootDir: root,
      }),
    ],
    build: { lib: { entry: "src/entry.ts", formats: ["es"] }, write: false },
  });

  expect(result).toBeDefined();
});
