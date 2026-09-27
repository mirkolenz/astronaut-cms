import { describe, expect, it } from "vitest";
import { cmsVitePlugin, type CmsVitePluginOptions } from "@/integration/vite-plugin";
import type { CmsRuntime } from "@/integration/types";
import { DEV_API_ENVIRONMENT } from "@/integration/dev-api";
import { client, server } from "./fixtures/server";

// Where a Workers binding is read from is settled while building, because the
// Workers `env` module only resolves inside a Workers bundle. The demo builds
// for no adapter at all, so this is what pins both halves.
function moduleFor(runtime: CmsRuntime, environment = "ssr"): string {
  const options: CmsVitePluginOptions = {
    clientConfig: client,
    serverConfig: server,
    userConfigPath: null,
    components: {},
    command: "build",
    rootDir: process.cwd(),
    entries: [],
    runtime,
  };
  const load = cmsVitePlugin(options).load as (this: unknown, id: string) => string;

  return load.call({ environment: { name: environment } }, "\0virtual:astronaut-cms/runtime");
}

const WORKERS_ENV = 'export { env } from "cloudflare:workers";';

describe("runtime env", () => {
  it("reads the Workers env module on cloudflare", () => {
    expect(moduleFor("cloudflare")).toContain(WORKERS_ENV);
  });

  it("has nothing to read anywhere else", () => {
    expect(moduleFor("node")).toContain("export const env = undefined;");
  });

  // `astro dev` serves the API from Node for local storage, whatever the adapter.
  it("has nothing to read in the dev API, even on cloudflare", () => {
    expect(moduleFor("cloudflare", DEV_API_ENVIRONMENT)).not.toContain(WORKERS_ENV);
  });
});
