/**
 * Node-only stand-ins for `astro:content` and `astro/loaders`, aliased in via
 * jiti when the integration loads the user's `content.config.ts` to extract
 * collection metadata (see `load-config.ts`).
 *
 * `astro:content` is a build-time virtual module that cannot be resolved
 * outside an Astro build, so it must be aliased to something. `defineCollection`
 * is the identity function and the loader helpers return marker objects that
 * capture their arguments, letting us recover the glob pattern / base / file
 * name without running a real loader. Schemas (including third-party ones such
 * as Starlight's `docsSchema()`) run for real here, since this executes in Node.
 *
 * Everything a real config can reach through these two modules is mirrored here,
 * and the assertions at the bottom fail the build if astro's side of that mirror
 * moves. All astro imports are types, so nothing is pulled into the bundle.
 */
import { z } from "zod";
import type * as AstroContentConfig from "astro/content/config";
import type * as AstroLoaders from "astro/loaders";

export { z };
export { referenceMarker as reference } from "../shared/cms-markers.ts";

// The options astro's own `glob()` takes, so the two fields read back below are
// named after astro's rather than after a copy of them.
type AstroGlobOptions = Parameters<typeof AstroLoaders.glob>[0];

/**
 * Shape captured by the `glob`/`file` loader stubs. `load-config.ts` reads
 * these fields back to recover the loader's pattern/base/file name.
 */
export interface LoaderMarker {
  __cmsPattern?: string | string[] | null;
  __cmsBase?: string | null;
  __cmsFileName?: string | null;
}

export function defineCollection<T>(config: T): T {
  return config;
}

export function glob(options: Pick<AstroGlobOptions, "pattern" | "base">): LoaderMarker {
  return {
    __cmsPattern: options.pattern ?? null,
    // astro also accepts a file URL as the base. The CMS addresses entries by
    // project-relative path (storage backends, the changeset, the dev
    // middleware), so a URL base is recorded as absent and the collection falls
    // back to the conventional directory rather than being mangled into a path.
    __cmsBase: typeof options.base === "string" ? options.base : null,
  };
}

export function file(fileName: Parameters<typeof AstroLoaders.file>[0]): LoaderMarker {
  return {
    __cmsFileName: fileName ?? null,
  };
}

// --- Drift assertions ------------------------------------------------------

// Each fails to compile if astro grows a config-time export this module does not
// stand in for, which would otherwise surface as a jiti `TypeError` at
// config:setup and degrade every collection to an empty manifest.
type AssertNever<_T extends never> = void;

export type AllLoadersStubbed = AssertNever<Exclude<keyof typeof AstroLoaders, "glob" | "file">>;

// `defineLiveCollection` is deliberately not stubbed: live collections belong to
// `src/live.config.ts`, which the CMS does not read, and astro rejects one
// declared in a content config itself.
export type AllContentHelpersStubbed = AssertNever<
  Exclude<keyof typeof AstroContentConfig, "defineCollection" | "defineLiveCollection">
>;
