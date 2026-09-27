/**
 * Host-facing asset resolver.
 *
 * Resolves CMS asset path strings to optimized assets via Vite `import.meta.glob`
 * maps (generated per-project by the CMS Vite plugin so the glob base follows the
 * configured `media.directory`). Paths are root-absolute (e.g. "/src/assets/hero.png");
 * relative paths (e.g. "./hero.png") resolve against a `base` argument (the
 * referencing content file, such as `entry.filePath`). Resolution happens at render
 * time and never touches the markdown processor, so it works under both `unified()`
 * and the Rust `satteri()` pipeline.
 *
 * Use {@link resolveImage} in `.astro` files (or the ready-made
 * `astronaut-cms/Image.astro` wrapper), and pass the resolved value to
 * `astro:assets` `<Image>`. React islands should receive an already-resolved
 * `src` from an `.astro` wrapper rather than calling these directly.
 */
import type { ImageMetadata } from "astro";
import { dirname, join } from "pathe";
import { images, files } from "virtual:astronaut-cms/assets";

// Map a stored asset path to its glob key. Absolute paths are keys as-is; relative
// paths resolve against `base`'s directory. pathe is POSIX-normalized on every
// platform, matching Vite's forward-slash glob keys and handling "." / "..".
function toKey(path: string, base: string | undefined): string {
  if (path.startsWith("/")) return path;

  if (!base) throw new Error(`Relative CMS asset path requires a base: ${path}`);

  const baseDir = dirname(join("/", base));

  return join(baseDir, path);
}

function resolve<T>(
  map: Record<string, () => Promise<T>>,
  kind: string,
  path: string,
  base: string | undefined,
): Promise<T> {
  const key = toKey(path, base);
  const loader = map[key];

  if (!loader) throw new Error(`CMS ${kind} not found: ${key}`);

  return loader();
}

/** Resolve an asset path to optimized image metadata. Absolute paths need no
 * `base`; relative paths resolve against `base` (e.g. `entry.filePath`). */
export const resolveImage = (path: string, base?: string): Promise<ImageMetadata> =>
  resolve(images, "image", path, base);

/** Resolve an asset path to a bundled file URL. See {@link resolveImage} for base semantics. */
export const resolveFile = (path: string, base?: string): Promise<string> =>
  resolve(files, "file", path, base);
