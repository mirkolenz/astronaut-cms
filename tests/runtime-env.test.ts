import { describe, expect, it } from "vitest";
import { cmsVitePlugin, type CmsVitePluginOptions } from "@/integration/vite-plugin";
import type { CmsRuntime } from "@/integration/types";
import clientConfig from "./fixtures/config";
import serverConfig from "./fixtures/server";

// Where a secret or a Workers binding is read from is settled while building,
// because the Workers `env` module only resolves inside a Workers bundle. The
// demo builds for no adapter at all, so this is what pins both halves.
const RUNTIME_ENV = "\0virtual:astronaut-cms/runtime-env";

function moduleFor(runtime: CmsRuntime): string {
  const options: CmsVitePluginOptions = {
    clientConfig,
    serverConfig,
    userConfigPath: null,
    collections: {},
    command: "build",
    rootDir: process.cwd(),
    entries: [],
    alwaysInclude: [],
    base: "/",
    runtime,
  };
  const load = cmsVitePlugin(options).load;

  return (load as (id: string) => string)(RUNTIME_ENV);
}

describe("runtime env module", () => {
  it("reads the Workers env module on cloudflare", () => {
    expect(moduleFor("cloudflare")).toContain('from "cloudflare:workers"');
  });

  it("has nothing to read anywhere else, so the reader falls back to process.env", () => {
    expect(moduleFor("node")).toBe("export default undefined;");
  });
});
