import { createJiti } from "jiti";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";
import { imageMarker, fileMarker, referenceMarker } from "../shared/cms-markers.ts";
import type { LoaderMarker } from "../internal/loader-stubs.ts";
import type { CollectionManifest, CollectionManifestEntry } from "../shared/types.ts";

// jiti aliases for the two build-time-only Astro modules a content config
// imports. Everything else (third-party loaders and schemas) runs for real.
const LOADER_STUBS = "astronaut-cms/internal";
const JITI_ALIAS: Record<string, string> = {
  "astro:content": LOADER_STUBS,
  "astro/loaders": LOADER_STUBS,
};

// Helpers injected into Astro's function-style schemas (`({ image }) => z.object(...)`).
const SCHEMA_HELPERS = {
  image: imageMarker,
  file: fileMarker,
  reference: referenceMarker,
};

interface RawCollection {
  type?: string;
  schema?: unknown;
  loader?: LoaderMarker;
}

/**
 * Loads the user's content config in Node and lowers every collection into a
 * fully serializable {@link CollectionManifest}. Returns `null` when the config
 * cannot be evaluated, so callers can degrade to an empty admin gracefully.
 */
export function loadCollections(
  contentConfigPath: string,
  rootDir: string,
): CollectionManifest | null {
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
      } satisfies CollectionManifestEntry;
    }

    return manifest;
  } catch {
    return null;
  }
}
