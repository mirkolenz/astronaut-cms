import { dirname, join } from "pathe";

/**
 * The single rule mapping a stored asset path to the key of the generated
 * `virtual:astronaut-cms/assets` maps. The render-time resolver
 * (`astronaut-cms/assets`) and the build-time content check both go through
 * here, so a relative reference can never normalize one way in one place and
 * another way in the other.
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
