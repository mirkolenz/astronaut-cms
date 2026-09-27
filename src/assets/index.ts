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
 * With an object-store media backend there is no map and nothing to bundle: the
 * value content stores is a library key, and resolving it means putting the
 * configured public base in front. `resolveImage` then hands back that URL
 * rather than `ImageMetadata`, which is exactly what `astro:assets` `<Image>`
 * takes for a remote image (`astronaut-cms/Image.astro` passes it on with
 * `inferSize`).
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
import { join } from "pathe";
import { assetKey } from "../shared/asset-path.ts";
import { mediaPath, remoteMediaUrl, type ClientMediaBackend } from "../shared/media.ts";
import { isAbsoluteUrl } from "../shared/url.ts";
import { images, files, media, referencedOnly } from "virtual:astronaut-cms/assets";

type RemoteBackend = Extract<ClientMediaBackend, { type: "remote" }>;

/**
 * Filled in for each site by the types the integration generates, with the
 * media backend it configures. Empty where those types are not loaded.
 */
export interface MediaRegistry {}

/**
 * What {@link resolveImage} returns: always image metadata for a repository
 * library, and a URL for an object store too, whose keys resolve to one.
 */
export type ResolvedImage = MediaRegistry extends { backend: "repo" }
  ? ImageMetadata
  : ImageMetadata | string;
type AssetKind = "image" | "file";

const remote: RemoteBackend | null = media.mediaBackend.type === "remote" ? media.mediaBackend : null;

/**
 * A key resolves without a lookup, since only the store knows what it holds, so
 * `mediaPath` decides what counts as one — the same rule the admin applies on
 * write. A project path is refused rather than pasted onto the public base,
 * which is what a site migrating from a repository library runs into.
 */
function libraryKey(path: string): string {
  const key = mediaPath(path, media);

  if (key == null) {
    throw new Error(
      `CMS asset "${path}" is a project path, but this site's media library is an object store, where an asset is named by its library key (e.g. "photos/hero.png").`,
    );
  }

  return key;
}

/**
 * The one place the backend is branched on, so a new one is added here rather
 * than in every exported resolver. A repository asset is loaded through the map;
 * for an object store an absolute URL passes through and a key becomes a URL
 * under the public base — or, for a dev run whose library is the working tree,
 * the file that key names, loaded through the map like any repository asset.
 */
async function resolve<T>(
  map: Record<string, () => Promise<T>>,
  kind: AssetKind,
  path: string,
  base?: string,
): Promise<T | string> {
  if (!remote) return load(map, kind, assetKey(path, base));

  if (isAbsoluteUrl(path)) return path;

  const key = libraryKey(path);

  if (remote.local) return load(map, kind, join("/", media.mediaDirectory, key));

  // Pure string work, which never reaches the store.
  return remoteMediaUrl(key, remote.publicUrl);
}

function load<T>(map: Record<string, () => Promise<T>>, kind: AssetKind, key: string): Promise<T> {
  const loader = map[key];

  if (!loader) throw new Error(`CMS ${kind} not found: ${key}${hint(kind, key)}`);

  return loader();
}

// In a build the maps are narrowed to what content references and to how its
// schema declares it, so a file plainly sitting on disk can still be missing
// here. Both narrowings are undone the same way, by naming the file in
// `media.alwaysInclude`; the hint says which one was hit.
function hint(kind: AssetKind, key: string): string {
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

/**
 * Resolve an asset path to optimized image metadata, or — with an object-store
 * backend — to the URL the image is served under. Absolute paths need no `base`;
 * relative paths resolve against `base` (e.g. `entry.filePath`).
 */
export const resolveImage = async (path: string, base?: string): Promise<ResolvedImage> =>
  // Only a remote backend yields a string, and the generated types name the backend.
  (await resolve(images, "image", path, base)) as ResolvedImage;

/** Resolve an asset path to a file URL. See {@link resolveImage} for base semantics. */
export const resolveFile = async (path: string, base?: string): Promise<string> =>
  resolve(files, "file", path, base);
