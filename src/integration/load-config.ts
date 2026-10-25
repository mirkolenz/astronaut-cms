import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, relative, resolve } from "pathe";
import { createRunnableDevEnvironment, resolveConfig, type Alias } from "vite";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";
import { repoImageMarker } from "../shared/cms-markers.ts";
import { processUserConfig, type ComponentManifest } from "../internal/user-config.ts";
import { componentEntries } from "../shared/component-lookup.ts";
import type { CollectionOptions, ComponentDefinition } from "../config.ts";
import type { LoaderMarker } from "../internal/loader-stubs.ts";
import type { SchemaContext } from "astro/content/config";
import {
  DATA_FORMATS,
  type AssertNever,
  type CollectionManifest,
  type CollectionManifestEntry,
} from "@/shared/types";
import { errorMessage } from "../shared/errors.ts";
import { editorStubPlugin } from "./vite-plugin.ts";

/**
 * The user's two config files, read in Node so the integration can see a live
 * `content.config.ts` and `cms.config.ts` without an Astro build around them.
 * Both lower to fully serializable manifests.
 *
 * They are loaded through Vite, as astro loads its own config, so an import
 * resolves exactly as it does in the site: tsconfig `paths` included.
 */

// The two build-time-only Astro modules a content config imports. Everything
// else (third-party loaders and schemas) runs for real, except the admin's
// editor primitives (see `editorStubPlugin`). Matched exactly, since an alias
// otherwise also claims every subpath of its key.
const ALIASES: Alias[] = [/^astro:content$/, /^astro\/loaders$/].map(
  (find) => ({ find, replacement: "astronaut-cms/internal" }),
);

/** Imports a config module, typed as the exports the caller reads. */
type ConfigImport = <T>(path: string) => Promise<T>;

/** Resolves an import as a module of `importer` would, to its file or null. */
type ConfigResolve = (id: string, importer: string) => Promise<string | null>;

const RUNNER = "astronaut_cms_config";

/**
 * Runs `load` against one throwaway Vite runner, so the configs share one
 * resolved config and the modules they both import are evaluated once.
 *
 * A config that fails to load leaves the admin without collections and the
 * build without the assets they reference, so the error is the integration's
 * to raise rather than to degrade around.
 */
async function withConfigImport<T>(
  rootDir: string,
  load: (load: ConfigImport, resolve: ConfigResolve) => Promise<T>,
) {
  const config = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root: rootDir,
      logLevel: "error",
      resolve: { alias: ALIASES, tsconfigPaths: true },
      plugins: [editorStubPlugin()],
      // A component's editor is JSX, which Node cannot run as written.
      oxc: { jsx: { runtime: "automatic" } },
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
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => environment.close());

  return await load(
    async <M>(path: string) => {
      try {
        return await environment.runner.import<M>(path);
      } catch (error) {
        throw new Error(`astronaut-cms: failed to load ${path}: ${errorMessage(error)}`, { cause: error });
      }
    },
    async (id, importer) => (await environment.pluginContainer.resolveId(id, importer))?.id ?? null,
  );
}

// Astro hands a function-style schema exactly one helper, `image`. Standing a
// marker in for it is what lets the admin read the field as a repository image
// picker while astro's real build does the importing; `libraryImage` wraps either. Offering more than astro does would only
// let a config lower cleanly here and then fail the actual build.
const SCHEMA_HELPERS = { image: repoImageMarker };

// Nothing at runtime would notice astro's bag growing a second helper: a config
// using it would lower cleanly here and throw in the real build, leaving the admin
// with a manifest the build disagrees with. Astro gaining one
// therefore has to fail this compile instead, on the next dependency bump.
export type SchemaHelpersMirrorAstro = AssertNever<
  Exclude<keyof SchemaContext, keyof typeof SCHEMA_HELPERS>
>;

interface RawCollection {
  type?: string;
  schema?: unknown;
  loader?: LoaderMarker;
}

/**
 * A loader path as the CMS addresses entries, relative to the project root.
 * astro accepts `./src/x`, `src/x`, an absolute path and a file URL alike, and
 * the storage backends compare paths as plain strings.
 */
function rootRelative(rootDir: string, path: string | URL | null | undefined): string | null {
  if (path == null) return null;

  return relative(rootDir, resolve(rootDir, typeof path === "string" ? path : fileURLToPath(path)));
}

/**
 * Loads the user's content config and lowers every collection into a fully
 * serializable {@link CollectionManifest}, each in astro's own id order until
 * `cms.config` says otherwise.
 */
async function loadCollections(
  load: ConfigImport,
  rootDir: string,
  contentConfigPath: string,
  warn: (message: string) => void,
): Promise<CollectionManifest> {
  const mod = await load<{ collections?: Record<string, RawCollection> }>(contentConfigPath);
  const manifest: CollectionManifest = {};

  for (const [name, collection] of Object.entries(mod.collections ?? {})) {
    const rawSchema =
      typeof collection.schema === "function"
        ? (collection.schema as (helpers: typeof SCHEMA_HELPERS) => unknown)(SCHEMA_HELPERS)
        : collection.schema;
    const loader = collection.loader;

    if (loader?.__cmsFileName != null) {
      const format = extname(loader.__cmsFileName).slice(1);

      if (loader.__cmsCustomParser || !DATA_FORMATS.some((supported) => supported === format)) {
        throw new Error(
          `Collection "${name}" uses file("${loader.__cmsFileName}") with a custom parser or unsupported format. The CMS can edit only JSON, YAML, and TOML file collections without a custom parser.`,
        );
      }
    }

    if (loader?.__cmsCustomId) {
      warn(
        `Collection "${name}" passes its own generateId to glob(), which the CMS cannot mirror. The admin names its entries by astro's default ids, so a reference it writes may not resolve.`,
      );
    }

    manifest[name] = {
      name,
      type: collection.type === "data" ? "data" : "content",
      schema: rawSchema == null ? null : zodToFieldSchema(rawSchema),
      loaderType: loader?.__cmsFileName != null ? "file" : "glob",
      loaderPattern: loader?.__cmsPattern ?? null,
      loaderBase: rootRelative(rootDir, loader?.__cmsBase),
      loaderFileName: rootRelative(rootDir, loader?.__cmsFileName),
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

  for (const [name, { sort, label, description }] of Object.entries(options)) {
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

    // The icon is a live component, which the admin reads off `cms.config` itself.
    resolved[name] = { ...collection, sort: sort ?? collection.sort, label, description };
  }

  return resolved;
}

/** What {@link loadConfigs} reads off the site's two configs. */
export interface LoadedConfigs {
  collections: CollectionManifest;
  components: ComponentManifest;
  /** The file of each component's `component`, by name, nested ones included. */
  componentFiles: Record<string, string>;
}

/**
 * Both configs, each empty when the site has none. The components are lowered
 * into the same {@link ComponentManifest} the admin bundle builds for itself at
 * runtime; the admin has to do its own pass because `icon` and `editor` are live
 * React refs, and a build wants nothing but the lowered prop schemas. What the
 * CMS can load but not mirror is reported through `warn`.
 */
export function loadConfigs(
  rootDir: string,
  paths: { content: string | null; cms: string | null },
  warn: (message: string) => void,
): Promise<LoadedConfigs> {
  return withConfigImport(rootDir, async (load, resolve) => {
    const [collections, cms] = await Promise.all([
      paths.content ? loadCollections(load, rootDir, paths.content, warn) : {},
      paths.cms ? load<CmsConfigModule>(paths.cms) : undefined,
    ]);

    const manifest = withOptions(collections, cms?.collections ?? {});
    const components = processUserConfig(cms?.components);
    const componentFiles = paths.cms
      ? await resolveComponents(cms?.components ?? {}, manifest, paths.cms, resolve)
      : {};

    return { collections: manifest, components, componentFiles };
  });
}

/**
 * Each component's file, resolved as an import of `cms.config` itself, so the
 * site's aliases apply. A missing one fails here rather than in the build of
 * the wrapper that imports it, and so does a component that points editors to
 * a collection the content config lacks, which would link nowhere.
 */
async function resolveComponents(
  components: Record<string, ComponentDefinition>,
  collections: CollectionManifest,
  configPath: string,
  resolve: ConfigResolve,
): Promise<Record<string, string>> {
  // processUserConfig has refused a name defined twice, so a repeated name is a reused definition.
  const unique = new Map(componentEntries(components));
  const files = await Promise.all(
    unique.entries().map(async ([name, { component, collections: targets = [] }]) => {
      const unknown = targets.find((collection) => !Object.hasOwn(collections, collection));

      if (unknown !== undefined) {
        throw new Error(`cms.config components: ${name} lists "${unknown}", which is not a collection of the content config.`);
      }

      const file = component ? await resolve(component, configPath) : null;

      if (!file || !existsSync(file)) {
        throw new Error(
          `cms.config components: ${name} renders with ${component ? `"${component}", which names no file` : "no component"}. Set its \`component\` to the .astro file, such as "@/components/${name}.astro".`,
        );
      }

      return [name, file] as const;
    }),
  );

  return Object.fromEntries(files);
}
