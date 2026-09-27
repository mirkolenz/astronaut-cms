/**
 * Host-facing asset resolver.
 *
 * Resolves CMS asset path strings to optimized assets via lazy loader maps the CMS
 * Vite plugin generates per project: in a build only for the assets content
 * actually references, in dev a glob over the whole `media.directory` so a freshly
 * uploaded file resolves without a restart. Paths are root-absolute (e.g.
 * "/src/assets/hero.png"); relative paths (e.g. "./hero.png") resolve against a
 * `base` argument (the referencing content file, such as `entry.filePath`).
 * Resolution happens at render time and never touches the markdown processor, so it
 * works under both `unified()` and the Rust `satteri()` pipeline.
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

// In a build the maps are narrowed to what content references and to how it
// references it, so a file plainly sitting on disk can still be missing here.
// Both narrowings are undone the same way, by naming the file in
// `media.alwaysInclude`; the hint says which one was hit.
function hint(kind: string, key: string): string {
  if (!referencedOnly) return "";

  if (kind === "file" && key in images) {
    return ". Content only references it through an image() field, so it is bundled as optimized images and its original is not kept; add it to media.alwaysInclude to bundle the file itself.";
  }

  return ". A build only bundles assets referenced by content; list it in media.alwaysInclude if this path comes from site code.";
}

/** Resolve an asset path to optimized image metadata. Absolute paths need no
 * `base`; relative paths resolve against `base` (e.g. `entry.filePath`). */
export const resolveImage = (path: string, base?: string): Promise<ImageMetadata> =>
  resolve(images, "image", path, base);

/** Resolve an asset path to a bundled file URL. See {@link resolveImage} for base semantics. */
export const resolveFile = (path: string, base?: string): Promise<string> =>
  resolve(files, "file", path, base);
