import { describe, expect, it } from "vitest";
import { cmsVitePlugin, type CmsVitePluginOptions } from "@/integration/vite-plugin";
import type { CmsRuntime } from "@/integration/types";
import { DEV_API_ENVIRONMENT } from "@/integration/dev-api";
import clientConfig from "./fixtures/config";
import serverConfig from "./fixtures/server";

// Where a Workers binding is read from is settled while building, because the
// Workers `env` module only resolves inside a Workers bundle. The demo builds
// for no adapter at all, so this is what pins both halves.
const RUNTIME_ENV = "\0virtual:astronaut-cms/runtime-env";

function moduleFor(runtime: CmsRuntime, environment = "ssr"): string {
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
  const load = cmsVitePlugin(options).load as (this: unknown, id: string) => string;

  return load.call({ environment: { name: environment } }, RUNTIME_ENV);
}

describe("runtime env module", () => {
  it("reads the Workers env module on cloudflare", () => {
    expect(moduleFor("cloudflare")).toContain('from "cloudflare:workers"');
  });

  it("has nothing to read anywhere else", () => {
    expect(moduleFor("node")).toBe("export default undefined;");
  });

  // `astro dev` serves the API from Node for local storage, whatever the adapter.
  it("has nothing to read in the dev API, even on cloudflare", () => {
    expect(moduleFor("cloudflare", DEV_API_ENVIRONMENT)).toBe("export default undefined;");
  });
});
