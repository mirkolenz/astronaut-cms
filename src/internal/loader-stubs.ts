/**
 * Node-only stand-ins for `astro:content` and `astro/loaders`, aliased in via
 * jiti when the integration loads the user's `content.config.ts` to extract
 * collection metadata (see `load-collections.ts`).
 *
 * `astro:content` is a build-time virtual module that cannot be resolved
 * outside an Astro build, so it must be aliased to something. `defineCollection`
 * is the identity function and the loader helpers return marker objects that
 * capture their arguments, letting us recover the glob pattern / base / file
 * name without running a real loader. Schemas (including third-party ones such
 * as Starlight's `docsSchema()`) run for real here, since this executes in Node.
 */
import { z } from "zod";

export { z };
export { referenceMarker as reference } from "../shared/cms-markers.ts";

/**
 * Shape captured by the `glob`/`file` loader stubs. `load-collections.ts` reads
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

export function glob(options: { pattern?: string | string[]; base?: string }): LoaderMarker {
  return {
    __cmsPattern: options.pattern ?? null,
    __cmsBase: options.base ?? null,
  };
}

export function file(fileName: string): LoaderMarker {
  return {
    __cmsFileName: fileName ?? null,
  };
}
