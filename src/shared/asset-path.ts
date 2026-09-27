import { dirname, extname, join } from "pathe";
import { ASTRO_IMAGE_FORMATS } from "./image-formats";

/**
 * The single rule mapping a stored asset path to the key of the generated
 * `virtual:astronaut-cms/assets` maps. The render-time resolver
 * (`astronaut-cms/assets`) and the build-time collector that decides which keys
 * the map even holds both go through here, so a relative reference can never
 * normalize one way in one place and another way in the other.
 *
 * Absolute paths are keys as-is; relative paths resolve against `base`'s
 * directory. pathe is POSIX-normalized on every platform, matching Vite's
 * forward-slash glob keys and handling "." / "..".
 */
export function assetKey(path: string, base: string | undefined): string {
  if (path.startsWith("/")) return path;

  if (!base) throw new Error(`Relative CMS asset path requires a base: ${path}`);

  const baseDir = dirname(join("/", base));

  return join(baseDir, path);
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(ASTRO_IMAGE_FORMATS);

/**
 * Whether a key belongs in the `images` map, by the same extension list the dev
 * glob filters on. Everything reachable goes into `files`; only these also get an
 * `astro:assets` import that yields ImageMetadata.
 */
export function isImageKey(key: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(key).slice(1).toLowerCase());
}
