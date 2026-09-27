import { createJiti } from "jiti";
import { SOURCE_EXPORTS } from "./self-resolve.ts";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";
import { imageMarker } from "../shared/cms-markers.ts";
import { processUserConfig, type ComponentManifest } from "../internal/user-config.ts";
import type { ComponentDefinition } from "../config.ts";
import type { LoaderMarker } from "../internal/loader-stubs.ts";
import type { SchemaContext } from "astro/content/config";
import type { CollectionManifest, CollectionManifestEntry } from "../shared/types.ts";

/**
 * The user's two config files, read in Node so the integration can see a live
 * `content.config.ts` and `cms.config.ts` without an Astro build around them.
 * Both lower to fully serializable manifests, and both degrade the same way.
 */

/** What a loader needs to report a config it could not evaluate. */
export interface ConfigLogger {
  warn: (message: string) => void;
}

// jiti aliases for the two build-time-only Astro modules a content config
// imports. Everything else (third-party loaders and schemas) runs for real.
const LOADER_STUBS = "astronaut-cms/internal";
const JITI_ALIAS: Record<string, string> = {
  ...SOURCE_EXPORTS,
  "astro:content": LOADER_STUBS,
  "astro/loaders": LOADER_STUBS,
};

// Astro hands a function-style schema exactly one helper, `image`. Standing a
// marker in for it is what lets the admin read the field as an image picker while
// astro's real build does the importing. Offering more than astro does would only
// let a config lower cleanly here and then fail the actual build.
const SCHEMA_HELPERS = { image: imageMarker };

// Nothing at runtime would notice astro's bag growing a second helper: a config
// using it would lower cleanly here and throw in the real build, leaving the admin
// with an empty manifest and a warning that explains nothing. Astro gaining one
// therefore has to fail this compile instead, on the next dependency bump.
type AssertNever<_T extends never> = void;
export type SchemaHelpersMirrorAstro = AssertNever<
  Exclude<keyof SchemaContext, keyof typeof SCHEMA_HELPERS>
>;

/**
 * The shared fallback policy: a config the integration cannot read costs the
 * admin its collections or the bundle its body assets, both of which say so, and
 * neither of which is worth refusing to build over. `consequence` is what the
 * warning tells the user they lost.
 */
function degrade<T>(
  logger: ConfigLogger,
  path: string,
  consequence: string,
  error: unknown,
  fallback: T,
): T {
  logger.warn(
    `Failed to load ${path}, so ${consequence}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );

  return fallback;
}

interface RawCollection {
  type?: string;
  schema?: unknown;
  loader?: LoaderMarker;
}

/**
 * Loads the user's content config and lowers every collection into a fully
 * serializable {@link CollectionManifest}, an empty one rather than a null every
 * caller would have to unwrap.
 */
export function loadCollections(
  contentConfigPath: string,
  rootDir: string,
  logger: ConfigLogger,
): CollectionManifest {
  try {
    const jiti = createJiti(rootDir, { alias: JITI_ALIAS });
    const mod = jiti(contentConfigPath) as { collections?: Record<string, RawCollection> };
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
  } catch (error) {
    return degrade(logger, contentConfigPath, "collections will be empty", error, {});
  }
}

/**
 * Loads the user's `cms.config.ts` and lowers its components into the same
 * {@link ComponentManifest} the admin bundle builds for itself at runtime.
 *
 * The admin has to do its own pass because `icon` and `editor` are live React
 * refs; a build wants nothing but the lowered prop schemas, which tell it which
 * component props name an asset.
 */
export function loadComponents(
  userConfigPath: string,
  rootDir: string,
  logger: ConfigLogger,
): ComponentManifest {
  try {
    const jiti = createJiti(rootDir, { alias: SOURCE_EXPORTS });
    const mod = jiti(userConfigPath) as { components?: Record<string, ComponentDefinition> };

    return processUserConfig(mod.components);
  } catch (error) {
    return degrade(
      logger,
      userConfigPath,
      "MDX bodies are checked without component schemas, and assets referenced from their props will not be bundled (list them in media.alwaysInclude)",
      error,
      {},
    );
  }
}
