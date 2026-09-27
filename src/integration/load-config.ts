import { createRunnableDevEnvironment, resolveConfig, type Alias } from "vite";
import { SOURCE_EXPORTS } from "./self-resolve.ts";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";
import { imageMarker } from "../shared/cms-markers.ts";
import { processUserConfig, type ComponentManifest } from "../internal/user-config.ts";
import type { CollectionOptions, ComponentDefinition } from "../config.ts";
import type { LoaderMarker } from "../internal/loader-stubs.ts";
import type { SchemaContext } from "astro/content/config";
import type { CollectionManifest, CollectionManifestEntry } from "../shared/types.ts";

/**
 * The user's two config files, read in Node so the integration can see a live
 * `content.config.ts` and `cms.config.ts` without an Astro build around them.
 * Both lower to fully serializable manifests.
 *
 * They are loaded through Vite, as astro loads its own config, so an import
 * resolves exactly as it does in the site: tsconfig `paths` included.
 */

// The two build-time-only Astro modules a content config imports. Everything
// else (third-party loaders and schemas) runs for real. Matched exactly, since
// an alias otherwise also claims every subpath of its key.
const LOADER_STUBS = SOURCE_EXPORTS["astronaut-cms/internal"] ?? "astronaut-cms/internal";
const ALIASES: Alias[] = Object.entries({
  ...SOURCE_EXPORTS,
  "astro:content": LOADER_STUBS,
  "astro/loaders": LOADER_STUBS,
}).map(([specifier, replacement]) => ({
  find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  replacement,
}));

/** Imports a config module, typed as the exports the caller reads. */
type ConfigImport = <T>(path: string) => Promise<T>;

const RUNNER = "astronaut_cms_config";

/**
 * Runs `load` against one throwaway Vite runner, so the configs share one
 * resolved config and the modules they both import are evaluated once.
 *
 * A config that fails to load leaves the admin without collections and the
 * build without the assets they reference, so the error is the integration's
 * to raise rather than to degrade around.
 */
async function withConfigImport<T>(rootDir: string, load: (load: ConfigImport) => Promise<T>) {
  const config = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root: rootDir,
      logLevel: "error",
      resolve: { alias: ALIASES, tsconfigPaths: true },
      // Dependencies run in Node as they are, as astro's own config loader has them.
      environments: {
        [RUNNER]: {
          consumer: "server",
          dev: { moduleRunnerTransform: true },
          resolve: { external: true, mainFields: [], conditions: ["node"] },
        },
      },
    },
    "serve",
  );
  const environment = createRunnableDevEnvironment(RUNNER, config, { hot: false });

  await environment.init();

  try {
    return await load(async <M>(path: string) => {
      try {
        return await environment.runner.import<M>(path);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new Error(`astronaut-cms: failed to load ${path}: ${reason}`, { cause: error });
      }
    });
  } finally {
    await environment.close();
  }
}

// Astro hands a function-style schema exactly one helper, `image`. Standing a
// marker in for it is what lets the admin read the field as an image picker while
// astro's real build does the importing. Offering more than astro does would only
// let a config lower cleanly here and then fail the actual build.
const SCHEMA_HELPERS = { image: imageMarker };

// Nothing at runtime would notice astro's bag growing a second helper: a config
// using it would lower cleanly here and throw in the real build, leaving the admin
// with a manifest the build disagrees with. Astro gaining one
// therefore has to fail this compile instead, on the next dependency bump.
type AssertNever<_T extends never> = void;
export type SchemaHelpersMirrorAstro = AssertNever<
  Exclude<keyof SchemaContext, keyof typeof SCHEMA_HELPERS>
>;

interface RawCollection {
  type?: string;
  schema?: unknown;
  loader?: LoaderMarker;
}

/**
 * Loads the user's content config and lowers every collection into a fully
 * serializable {@link CollectionManifest}, each in astro's own id order until
 * `cms.config` says otherwise.
 */
async function loadCollections(
  load: ConfigImport,
  contentConfigPath: string,
): Promise<CollectionManifest> {
  const mod = await load<{ collections?: Record<string, RawCollection> }>(contentConfigPath);
  const manifest: CollectionManifest = {};

  for (const [name, collection] of Object.entries(mod.collections ?? {})) {
    const rawSchema =
      typeof collection.schema === "function"
        ? (collection.schema as (helpers: typeof SCHEMA_HELPERS) => unknown)(SCHEMA_HELPERS)
        : collection.schema;
    const loader = collection.loader;

    manifest[name] = {
      name,
      type: collection.type === "data" ? "data" : "content",
      schema: rawSchema == null ? null : zodToFieldSchema(rawSchema),
      loaderType: loader?.__cmsFileName != null ? "file" : "glob",
      loaderPattern: loader?.__cmsPattern ?? null,
      loaderBase: loader?.__cmsBase ?? null,
      loaderFileName: loader?.__cmsFileName ?? null,
      sort: "id",
    } satisfies CollectionManifestEntry;
  }

  return manifest;
}

/** The two exports of `cms.config.ts` the integration reads. */
interface CmsConfigModule {
  components?: Record<string, ComponentDefinition>;
  collections?: Record<string, CollectionOptions>;
}

/**
 * The content config's collections with the options `cms.config` gives them.
 * An option naming no collection, or a file order for entries that are separate
 * files, is a mistake the site would otherwise never notice.
 */
function withOptions(
  manifest: CollectionManifest,
  options: Record<string, CollectionOptions>,
): CollectionManifest {
  const resolved = { ...manifest };

  for (const [name, { sort }] of Object.entries(options)) {
    const collection = resolved[name];

    if (!collection) {
      throw new Error(
        `cms.config collections: "${name}" is not a collection of the content config.`,
      );
    }

    if (sort === "file" && collection.loaderType !== "file") {
      throw new Error(
        `cms.config collections: "${name}" cannot sort by "file", which needs a file() collection. The entries of a glob() collection are separate files.`,
      );
    }

    if (sort) resolved[name] = { ...collection, sort };
  }

  return resolved;
}

/**
 * Both configs, each empty when the site has none. The components are lowered
 * into the same {@link ComponentManifest} the admin bundle builds for itself at
 * runtime; the admin has to do its own pass because `icon` and `editor` are live
 * React refs, and a build wants nothing but the lowered prop schemas.
 */
export function loadConfigs(
  rootDir: string,
  paths: { content: string | null; cms: string | null },
): Promise<{ collections: CollectionManifest; components: ComponentManifest }> {
  return withConfigImport(rootDir, async (load) => {
    const [collections, cms] = await Promise.all([
      paths.content ? loadCollections(load, paths.content) : {},
      paths.cms ? load<CmsConfigModule>(paths.cms) : undefined,
    ]);

    return {
      collections: withOptions(collections, cms?.collections ?? {}),
      components: processUserConfig(cms?.components),
    };
  });
}
