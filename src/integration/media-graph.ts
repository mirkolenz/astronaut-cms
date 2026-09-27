/** On-demand media reach and emitted asset ownership, which decide what a build may prune. */
import type { IntegrationResolvedRoute } from "astro";
import { join, resolve } from "pathe";
import type { Plugin } from "vite";
import { isLibraryFile, type ClientMediaConfig } from "../shared/media.ts";
import { stripMediaPrefix } from "../shared/paths.ts";
import { trimSlashes } from "../shared/url.ts";
import { pruneMedia, type EmittedAsset } from "./prune-media.ts";

/** What of a resolved route decides whether its code can render media on demand. */
type Route = Pick<IntegrationResolvedRoute, "entrypoint" | "isPrerendered" | "origin" | "pattern">;

export interface MediaGraphOptions {
  rootDir: string;
  /** Absolute, with a trailing slash. */
  srcDir: string;
  media: ClientMediaConfig;
  /** Patterns of on-demand routes that render no library file, the CMS's own. */
  ignore: string[];
}

export interface MediaGraph {
  plugins: Plugin[];
  setRoutes(routes: Route[]): void;
  /** Patterns of the site's on-demand routes. */
  readonly onDemand: string[];
  /** Null when on-demand code makes default pruning unsafe. */
  prune(clientDir: string, force: boolean): Map<string, number> | null;
}

const withoutQuery = (id: string): string => id.split("?", 1)[0] ?? id;

export function mediaGraph({ rootDir, srcDir, media, ignore }: MediaGraphOptions): MediaGraph {
  const ignored = new Set(ignore.map(trimSlashes));
  const repoDir = join(rootDir, media.repo.directory);

  const inLibrary = (id: string): boolean => {
    const key = stripMediaPrefix(withoutQuery(id), repoDir);

    return key != null && isLibraryFile(key, media.repo.extensions);
  };

  let onDemand: Route[] = [];
  let routeEntries = new Set<string>();
  let onDemandMedia = false;
  const emitted: EmittedAsset[] = [];

  const graph: Plugin = {
    name: "astronaut-cms:media-graph",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "ssr",

    async buildEnd() {
      const [content, assets, ...routes] = await Promise.all([
        this.resolve("astro:content"),
        this.resolve("virtual:astronaut-cms/assets"),
        ...onDemand.map(({ entrypoint }) => this.resolve(resolve(rootDir, entrypoint))),
      ]);
      const renders = (id: string): boolean => inLibrary(id) || id === content?.id || id === assets?.id;
      // Route entries and server islands, the site's own code that renders on demand.
      const stack = [
        ...routes.flatMap((route) => route ? [route.id] : []),
        ...[...this.getModuleIds()].filter(
          (id) => this.getModuleInfo(id)?.isEntry && id.startsWith(srcDir) && !routeEntries.has(withoutQuery(id)),
        ),
      ];
      const reaches = (): boolean => {
        const seen = new Set<string>();

        for (let id = stack.pop(); id != null; id = stack.pop()) {
          if (seen.has(id)) continue;

          seen.add(id);

          if (renders(id)) return true;

          const info = this.getModuleInfo(id);

          if (info) stack.push(...info.importedIds, ...info.dynamicallyImportedIds);
        }

        return false;
      };

      onDemandMedia = routes.some((route) => !route || !this.getModuleInfo(route.id)) || reaches();
    },
  };

  // Every environment, since server builds emit assets into the client output too.
  const emittedAssets: Plugin = {
    name: "astronaut-cms:media-graph-assets",
    apply: "build",

    generateBundle: {
      order: "post",
      handler(_, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type === "asset") {
            emitted.push({
              fileName: item.fileName,
              originalFileNames: item.originalFileNames.map((name) => resolve(rootDir, name)),
            });
          }
        }
      },
    },
  };

  return {
    plugins: [graph, emittedAssets],

    get onDemand() {
      return onDemand.map(({ pattern }) => pattern);
    },

    setRoutes(routes) {
      routeEntries = new Set(routes.map(({ entrypoint }) => resolve(rootDir, entrypoint)));
      onDemand = routes
        .filter((route) => !route.isPrerendered && route.origin !== "internal" && !ignored.has(trimSlashes(route.pattern)));
    },

    prune(clientDir, force) {
      if (!force && onDemandMedia) return null;

      return pruneMedia(clientDir, inLibrary, emitted);
    },
  };
}
