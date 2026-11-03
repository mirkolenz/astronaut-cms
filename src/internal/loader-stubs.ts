/**
 * Node-only stand-ins for `astro:content` and `astro/loaders`, aliased in via
 * Vite when the integration loads the user's `content.config.ts` to extract
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
import type { AssertNever } from "@/shared/types";

export { z };
export { referenceMarker as reference } from "@/shared/cms-markers";

// The options astro's own `glob()` takes, so the two fields read back below are
// named after astro's rather than after a copy of them.
type AstroGlobOptions = Parameters<typeof AstroLoaders.glob>[0];

/**
 * Shape captured by the `glob`/`file` loader stubs. `load-config.ts` reads
 * these fields back to recover the loader's pattern/base/file name.
 */
export interface LoaderMarker {
  __cmsPattern?: string | string[] | null;
  __cmsBase?: string | URL | null;
  __cmsFileName?: string | null;
  __cmsCustomParser?: true;
  __cmsCustomId?: true;
}

export function defineCollection<T>(config: T): T {
  return config;
}

export function glob(
  options: Pick<AstroGlobOptions, "pattern" | "base" | "generateId">,
): LoaderMarker {
  return {
    __cmsPattern: options.pattern,
    // Astro reads from the project root when no base is given.
    __cmsBase: options.base ?? ".",
    ...(options.generateId && { __cmsCustomId: true }),
  };
}

export function file(
  fileName: Parameters<typeof AstroLoaders.file>[0],
  options?: Parameters<typeof AstroLoaders.file>[1],
): LoaderMarker {
  return {
    __cmsFileName: fileName ?? null,
    ...(options?.parser && { __cmsCustomParser: true }),
  };
}

// --- Drift assertions ------------------------------------------------------

// Each fails to compile if astro grows a config-time export this module does not
// stand in for, which would otherwise surface as a `TypeError` at config:setup
// in any site whose content config uses it.
export type AllLoadersStubbed = AssertNever<Exclude<keyof typeof AstroLoaders, "glob" | "file">>;

// `defineLiveCollection` is deliberately not stubbed: live collections belong to
// `src/live.config.ts`, which the CMS does not read, and astro rejects one
// declared in a content config itself.
export type AllContentHelpersStubbed = AssertNever<
  Exclude<keyof typeof AstroContentConfig, "defineCollection" | "defineLiveCollection">
>;
