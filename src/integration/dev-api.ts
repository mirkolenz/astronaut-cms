/**
 * The CMS API served from Node by `astro dev` itself, for local storage.
 *
 * An adapter may render on demand in a runtime other than Node, such as workerd
 * for `@astrojs/cloudflare`, where `node:fs` cannot see the project. The working
 * tree is only reachable from Node, so the API runs in a Node environment of its
 * own and answers before the adapter's handler sees the request. Every adapter
 * takes this path, so the demo exercises the one a Workers site runs.
 */
import { createRequestFromNodeRequest, writeResponse } from "astro/app/node";
import {
  createRunnableDevEnvironment,
  type EnvironmentOptions,
  type RunnableDevEnvironment,
  type ViteDevServer,
} from "vite";

/** The Vite environment the dev API runs in. */
export const DEV_API_ENVIRONMENT = "astronaut_cms";

type Endpoint = typeof import("../server/endpoint.ts");

export const devApiEnvironment: EnvironmentOptions = {
  consumer: "server",
  // The package imports the virtual modules, so Vite has to transform it rather
  // than hand it to Node.
  resolve: { noExternal: ["astronaut-cms"] },
  dev: { createEnvironment: (name, config) => createRunnableDevEnvironment(name, config) },
};

/** Answers every request below `apiPath` from the dev API environment. */
export function serveDevApi(server: ViteDevServer, apiPath: string): void {
  const environment = server.environments[DEV_API_ENVIRONMENT] as RunnableDevEnvironment;

  server.middlewares.use((req, res, next) => {
    const path = req.url?.split("?")[0] ?? "";

    if (path !== apiPath && !path.startsWith(`${apiPath}/`)) return next();

    environment.runner
      .import<Endpoint>("astronaut-cms/endpoint")
      // Astro's own bridge, the one its Node adapter serves production with, so
      // a browser that goes away aborts `request.signal` and cancels the body.
      .then(({ handle }) => handle(createRequestFromNodeRequest(req)))
      .then((response) => writeResponse(response, res))
      .catch(next);
  });
}
