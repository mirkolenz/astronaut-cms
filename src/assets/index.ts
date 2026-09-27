/**
 * Host-facing asset resolver.
 *
 * Resolves CMS asset path strings to optimized assets via lazy loader maps the CMS
 * Vite plugin generates per project: in a build only for the assets content
 * actually references, in dev a glob over the whole `media.directory` so a freshly
 * uploaded file resolves without a restart. Paths are root-absolute (e.g.
 * "/src/assets/hero.png"); relative paths (e.g. "./hero.png") resolve against a
 * `base` argument (the referencing content file, such as `entry.filePath`).
 *
 * What needs resolving here is what astro cannot resolve for you: the `image()`
 * and `file()` props of MDX components, and `file()` collection fields. A
 * collection's `image()` fields are not among them. Astro imports those into
 * `entry.data` itself, so `entry.data.cover` is already `ImageMetadata`.
 *
 * Resolution happens at render time and never touches the markdown processor, so
 * it works under both the default `satteri()` pipeline and `unified()`.
 *
 * Use {@link resolveImage} in `.astro` files (or the ready-made
 * `astronaut-cms/Image.astro` wrapper), and pass the resolved value to
 * `astro:assets` `<Image>`. React islands should receive an already-resolved
 * `src` from an `.astro` wrapper rather than calling these directly.
 */
import type { ImageMetadata } from "astro";
import { assetKey } from "../shared/asset-path.ts";
import { images, files, referencedOnly } from "virtual:astronaut-cms/assets";

function resolve<T>(
  map: Record<string, () => Promise<T>>,
  kind: string,
  path: string,
  base: string | undefined,
): Promise<T> {
  const key = assetKey(path, base);
  const loader = map[key];

  if (!loader) throw new Error(`CMS ${kind} not found: ${key}${hint(kind, key)}`);

  return loader();
}

// In a build the maps are narrowed to what content references and to how its
// schema declares it, so a file plainly sitting on disk can still be missing
// here. Both narrowings are undone the same way, by naming the file in
// `media.alwaysInclude`; the hint says which one was hit.
function hint(kind: string, key: string): string {
  if (!referencedOnly) return "";

  // A key in the other map is a mismatch between how content declares the asset
  // and which resolver the site calls on it, which the generic hint would send
  // the user to fix in the wrong place.
  if (kind === "file" && key in images) {
    return ". Content only declares it with image(), so it is bundled as optimized images and its original is not kept; declare it with file() or add it to media.alwaysInclude to bundle the file itself.";
  }

  if (kind === "image" && key in files) {
    return ". Content only declares it with file(), so it is bundled as the original file; declare it with image() to get optimized images.";
  }

  return ". A build only bundles assets referenced by content; list it in media.alwaysInclude if this path comes from site code. A collection image() field is astro's to import, so read it straight off entry.data instead of resolving it here.";
}

/** Resolve an asset path to optimized image metadata. Absolute paths need no
 * `base`; relative paths resolve against `base` (e.g. `entry.filePath`). */
export const resolveImage = (path: string, base?: string): Promise<ImageMetadata> =>
  resolve(images, "image", path, base);

/** Resolve an asset path to a bundled file URL. See {@link resolveImage} for base semantics. */
export const resolveFile = (path: string, base?: string): Promise<string> =>
  resolve(files, "file", path, base);
