import { globSync, readFileSync } from "node:fs";
import { join, relative } from "pathe";
import { assetKey } from "../shared/asset-path.ts";
import { isAstroImage } from "../shared/image-formats.ts";
import { getFileExtension, parseContent, parseMultiEntryFile } from "../shared/content-parser.ts";
import type { ComponentSchemaMap } from "../shared/field-schema.ts";
import { validateMdx } from "../shared/mdx-validation.ts";
import { dataLeaves, type ResolvableLeaf } from "../shared/resolvable-leaves.ts";
import {
  collectionBase,
  type CollectionManifest,
  type CollectionManifestEntry,
} from "../shared/types.ts";

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
 * in site code, which is what `media.alwaysInclude` is for.
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
  /** Project-relative media directory, e.g. "src/assets". */
  mediaDirectory: string;
  collections: CollectionManifest;
  /** The `cms.config` components, for the prop schemas of MDX bodies. */
  components: ComponentSchemaMap;
  /** Extra glob patterns, relative to the media directory, to bundle unconditionally. */
  alwaysInclude: string[];
}

export function collectReferencedAssets({
  rootDir,
  mediaDirectory,
  collections,
  components,
  alwaysInclude,
}: CollectAssetsOptions): CollectedAssets {
  const mediaDir = join(rootDir, mediaDirectory);
  const keyOf = (path: string): string => join("/", relative(rootDir, path));

  // The library itself, listed once, so deciding whether a value names an asset
  // is a lookup rather than a syscall per candidate.
  const mediaFiles = new Set(globFiles(mediaDir, "**/*").map(keyOf));

  const images = new Set<string>();
  const files = new Set<string>();

  for (const collection of Object.values(collections)) {
    for (const file of entryFiles(rootDir, collection)) {
      const raw = readFileSync(join(rootDir, file), "utf-8");
      const format = getFileExtension(file);

      for (const { value, where, map } of entryAssets(collection, components, raw, format)) {
        const key = assetKey(value, file);

        if (!mediaFiles.has(key)) {
          throw new Error(
            `astronaut-cms: ${file} (${where}) references "${value}", which is not a file in the media directory ("${mediaDirectory}").`,
          );
        }

        if (map === "images") images.add(key);
        if (map === "files") files.add(key);
      }
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

/** Absolute paths of the files matching `patterns`, directories excluded. */
function globFiles(cwd: string, patterns: string | string[]): string[] {
  if (patterns.length === 0) return [];

  // withFileTypes answers "is this a directory" from the walk itself, so no match
  // costs an extra stat. A cwd that does not exist globs to nothing.
  return globSync(patterns, { cwd, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Project-relative paths of the files a collection loads its entries from. */
function entryFiles(rootDir: string, collection: CollectionManifestEntry): string[] {
  // A file collection names one literal path, which is a glob pattern matching
  // itself, or nothing when the file is absent.
  const isFile = collection.loaderType === "file";
  const cwd = isFile ? rootDir : join(rootDir, collectionBase(collection.name, collection));
  const patterns = isFile
    ? (collection.loaderFileName ?? [])
    : (collection.loaderPattern ?? "**/*");

  return globFiles(cwd, patterns).map((path) => relative(rootDir, path));
}

/** One asset an entry names, and which generated map has to resolve it. */
interface AssetCandidate {
  value: string;
  /** The field or prop it was written in, for the error message. */
  where: string;
  /** The map that must hold it, or null when the asset is astro's to import. */
  map: "images" | "files" | null;
}

/** Every asset an entry names: its schema-declared fields, then its MDX components. */
function* entryAssets(
  collection: CollectionManifestEntry,
  components: ComponentSchemaMap,
  raw: string,
  format: string,
): Generator<AssetCandidate> {
  // A file collection holds many entries in one file and has no body, so each is
  // walked against the schema separately and named by its id in any error.
  if (collection.loaderType === "file") {
    for (const [id, data] of Object.entries(parseMultiEntryFile(raw, format).entries)) {
      yield* candidates(dataLeaves(collection.schema, data), `entry "${id}"`, null);
    }

    return;
  }

  const { data, body } = parseContent(raw, format);

  yield* candidates(dataLeaves(collection.schema, data), "frontmatter", null);

  // A component prop is the one image reference astro has no mechanism for, so
  // unlike a collection field it does have to be bundled here. `validateMdx`
  // yields nothing for a format whose bodies carry no components.
  yield* candidates(validateMdx(body, format, components).leaves, null, "images");
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
    };
  }
}
