import { join, relative } from "pathe";
import { assetKey } from "../shared/asset-path.ts";
import { isAstroImage } from "../shared/image-formats.ts";
import { mediaPath, repoOnlyRefusal, type ClientMediaConfig } from "../shared/media.ts";
import { dataLeaves, type ResolvableLeaf } from "../shared/resolvable-leaves.ts";
import { globFiles, type ContentEntry } from "./content-files.ts";

/**
 * Build-time collection of every media path the site can actually reach, so a
 * production build bundles those and nothing else. A glob over the media
 * directory is a static set of dynamic imports, so Rollup emits an asset for
 * every match, and an asset that is never resolved is also never transformed, so
 * its full-size original ships.
 *
 * Reachability is decided from the content on disk, which is the complete
 * picture: the admin commits entries through the storage backend before a build
 * runs, and i18n fallbacks render an entry from another locale directory, a file
 * this walk already visits. What content cannot account for is a path hard-coded
 * in site code, which is what `media.repo.alwaysInclude` is for. The object store
 * is never bundled, so its references are left for astro to fetch.
 *
 * Both sources of asset paths are read through their schema: a frontmatter or
 * data field through the collection's, an MDX component prop through the one its
 * `cms.config` entry declares. Nothing is inferred from the shape of a string,
 * so a prop that merely looks path-shaped is left alone and every value that is
 * collected is known to be an `image()` or a `file()`.
 */

/** The key lists backing the two maps of `virtual:astronaut-cms/assets`. */
export interface CollectedAssets {
  images: string[];
  files: string[];
}

export interface CollectAssetsOptions {
  rootDir: string;
  media: ClientMediaConfig;
  /** The entries on disk, their bodies walked against the `cms.config` components. */
  entries: ContentEntry[];
}

export function collectReferencedAssets({
  rootDir,
  media,
  entries,
}: CollectAssetsOptions): CollectedAssets {
  const { directory, alwaysInclude } = media.repo;
  const mediaDir = join(rootDir, directory);
  const keyOf = (path: string): string => join("/", relative(rootDir, path));

  // The library itself, listed once, so deciding whether a value names an asset
  // is a lookup rather than a syscall per candidate.
  const mediaFiles = new Set(globFiles(mediaDir, "**/*").map(keyOf));

  const images = new Set<string>();
  const files = new Set<string>();

  for (const entry of entries) {
    const { file } = entry;

    for (const { value, where, map, repoOnly } of entryAssets(entry)) {
      if (mediaPath(value, media)?.library === "s3") {
        if (!repoOnly) continue;

        throw new Error(`astronaut-cms: ${file} (${where}): ${repoOnlyRefusal(value)}`);
      }

      const key = assetKey(value, file);

      if (!mediaFiles.has(key)) {
        throw new Error(
          `astronaut-cms: ${file} (${where}) references "${value}", which is not a file in the media directory ("${directory}").`,
        );
      }

      if (map === "images") images.add(key);
      if (map === "files") files.add(key);
    }
  }

  // An always-included file is bundled precisely because no content explains what
  // it is for, so it goes into every map that can load it, exactly as in dev.
  for (const key of globFiles(mediaDir, alwaysInclude).map(keyOf)) {
    if (isAstroImage(key)) images.add(key);
    files.add(key);
  }

  return { images: [...images].sort(), files: [...files].sort() };
}

/** One asset an entry names, and which generated map has to resolve it. */
interface AssetCandidate {
  value: string;
  /** The field or prop it was written in, for the error message. */
  where: string;
  /** The map that must hold it, or null when the asset is astro's to import. */
  map: "images" | "files" | null;
  repoOnly?: true;
}

/** Every asset an entry names: its schema-declared fields, then its MDX components. */
function* entryAssets({ collection, scope, data, body }: ContentEntry): Generator<AssetCandidate> {
  yield* candidates(dataLeaves(collection.schema, data), scope, null);

  // A component prop is the one image reference astro has no mechanism for, so
  // unlike a collection field it does have to be bundled here. Only an MDX body
  // carries components, so any other body walks to no leaves.
  if (body) yield* candidates(body.leaves, null, "images");
}

/**
 * Lowers the resolvable leaves of one source into asset candidates. `imageMap`
 * is where an `image()` from this source has to be bundled, which is the only
 * thing that separates a collection field from a component prop: astro imports
 * the former into `entry.data` itself, so it is checked here and bundled by
 * nobody. A `scope` prefixes the leaf path where the leaf's own is not enough to
 * locate it.
 */
function* candidates(
  leaves: ResolvableLeaf[],
  scope: string | null,
  imageMap: "images" | null,
): Generator<AssetCandidate> {
  for (const leaf of leaves) {
    if (leaf.kind === "reference") continue;

    yield {
      value: leaf.value,
      where: scope ? `${scope} ${leaf.path}` : leaf.path,
      map: leaf.kind === "image" ? imageMap : "files",
      repoOnly: leaf.repoOnly,
    };
  }
}
