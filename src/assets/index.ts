/**
 * Host-facing asset resolver.
 *
 * Resolves CMS asset path strings to optimized assets via lazy loader maps the CMS
 * Vite plugin generates per project, a glob over each library directory, so any
 * file resolves, in dev a freshly uploaded one without a restart. Paths are
 * root-absolute (e.g. "/src/assets/hero.png"), relative paths (e.g. "./hero.png")
 * resolve against a `base` argument (the referencing content file, such as `entry.filePath`).
 *
 * An object-store reference is its public URL already, so there is no map and
 * nothing to bundle: `resolveImage` hands the URL back rather than
 * `ImageMetadata`, which is exactly what `astro:assets` `<Image>` takes for a
 * remote image (`astronaut-cms/Image.astro` passes it on with `inferSize`).
 *
 * What needs resolving here is what astro cannot resolve for you: the `image()`
 * and `file()` props of MDX components, and `file()` collection fields. A
 * collection's `image()` fields are not among them. Astro imports a repository
 * one into `entry.data` itself, and leaves an object-store URL as it is, so
 * `entry.data.cover` is either `ImageMetadata` or a URL that `Image.astro` takes.
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
import { join } from "pathe";
import { assetKey } from "../shared/asset-path.ts";
import { mediaPath } from "../shared/media.ts";
import { images, files, media } from "virtual:astronaut-cms/assets";

/**
 * Filled in for each site by the types the integration generates, with whether
 * it configures an object store. Empty where those types are not loaded.
 */
export interface MediaRegistry {}

/**
 * What {@link resolveImage} returns: always image metadata for a site with only
 * the repository library, and a URL for an object-store file too.
 */
export type ResolvedImage = MediaRegistry extends { s3: false }
  ? ImageMetadata
  : ImageMetadata | string;
type AssetKind = "image" | "file";

/**
 * The one place the libraries are told apart, so a new one is added here rather
 * than in every exported resolver. A repository asset is loaded through the map,
 * and an object-store URL passes through, or, for a dev run whose store is the
 * working tree, becomes the file there, loaded through the map like any other.
 */
async function resolve<T>(
  map: Record<string, () => Promise<T>>,
  kind: AssetKind,
  ref: string,
  base?: string,
): Promise<T | string> {
  const location = mediaPath(ref, media, base);

  if (location?.library !== "s3") return load(map, kind, assetKey(ref, base));

  const directory = media.s3?.directory;

  // Pure string work, which never reaches the store.
  return directory == null ? ref : load(map, kind, join("/", directory, location.path));
}

function load<T>(map: Record<string, () => Promise<T>>, kind: AssetKind, key: string): Promise<T> {
  const loader = map[key];

  if (!loader) throw new Error(`CMS ${kind} not found: ${key}`);

  return loader();
}

/**
 * Resolve an asset reference to optimized image metadata, or, for an
 * object-store file, to the URL the image is served under. Absolute paths need
 * no `base`, relative paths resolve against `base` (e.g. `entry.filePath`).
 */
export const resolveImage = async (path: string, base?: string): Promise<ResolvedImage> =>
  // Only an object store yields a string, and the generated types say whether there is one.
  (await resolve(images, "image", path, base)) as ResolvedImage;

/** Resolve an asset path to a file URL. See {@link resolveImage} for base semantics. */
export const resolveFile = async (path: string, base?: string): Promise<string> =>
  resolve(files, "file", path, base);
