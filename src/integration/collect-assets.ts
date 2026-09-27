import { globSync, readFileSync } from "node:fs";
import { join, relative } from "pathe";
import { assetKey, isImageKey } from "../shared/asset-path.ts";
import { getFileExtension, parseContent, parseMultiEntryFile } from "../shared/content-parser.ts";
import type { FieldSchema } from "../shared/field-schema.ts";
import { dataLeaves } from "../shared/resolvable-leaves.ts";
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
  /** Extra glob patterns, relative to the media directory, to bundle unconditionally. */
  alwaysInclude: string[];
}

export function collectReferencedAssets({
  rootDir,
  mediaDirectory,
  collections,
  alwaysInclude,
}: CollectAssetsOptions): CollectedAssets {
  const mediaDir = join(rootDir, mediaDirectory);
  const keyOf = (path: string): string => join("/", relative(rootDir, path));

  // The library itself, listed once, so deciding whether a value names an asset
  // is a lookup rather than a syscall per candidate.
  const mediaFiles = new Set(globFiles(mediaDir, "**/*").map(keyOf));

  const images = new Set<string>();
  const files = new Set<string>();

  // An asset reached only through `image()` gets no `?url` entry: astro:assets
  // replaces it with transformed variants and drops the original, so the entry
  // would resurrect the full-size file for nothing. A body reference stays in,
  // since no schema says which resolver the site will call on it.
  const admit = (key: string, imageOnly: boolean): void => {
    if (isImageKey(key)) images.add(key);

    if (!imageOnly) files.add(key);
  };

  for (const collection of Object.values(collections)) {
    for (const file of entryFiles(rootDir, collection)) {
      const raw = readFileSync(join(rootDir, file), "utf-8");
      const format = getFileExtension(file);

      for (const { value, where, isImage } of entryAssets(collection, raw, format)) {
        const key = assetKey(value, file);

        if (!mediaFiles.has(key)) {
          // A schema-declared asset naming no file in the library is a broken
          // entry; an undeclared body literal that names nothing is just a string.
          if (where) {
            throw new Error(
              `astronaut-cms: ${file} (${where}) references "${value}", which is not a file in the media directory ("${mediaDirectory}").`,
            );
          }

          continue;
        }

        admit(key, isImage);
      }
    }
  }

  // An always-included file is bundled precisely because no content explains what
  // it is for, so it goes into both maps.
  for (const key of globFiles(mediaDir, alwaysInclude).map(keyOf)) admit(key, false);

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

interface AssetCandidate {
  value: string;
  /** The schema field it was declared in, for the error; null for a body literal. */
  where: string | null;
  isImage: boolean;
}

/** Every asset an entry file can name: its schema-declared fields, then its body. */
function* entryAssets(
  collection: CollectionManifestEntry,
  raw: string,
  format: string,
): Generator<AssetCandidate> {
  // A file collection holds many entries in one file and has no body, so each is
  // walked against the schema separately and named by its id in any error.
  if (collection.loaderType === "file") {
    for (const [id, data] of Object.entries(parseMultiEntryFile(raw, format).entries)) {
      yield* declaredAssets(collection.schema, data, `entry "${id}"`);
    }

    return;
  }

  const { data, body } = parseContent(raw, format);

  yield* declaredAssets(collection.schema, data, "frontmatter");

  // MDX and Markdoc bodies carry component and tag props the site resolves
  // through the asset map, exactly like a frontmatter value. A Markdown body is
  // prose: Astro resolves its relative images itself, and scanning it here would
  // bundle a second, unoptimized copy of each.
  if (format !== "mdx" && format !== "mdoc") return;

  for (const value of quotedStrings(body)) yield { value, where: null, isImage: false };
}

function* declaredAssets(
  schema: FieldSchema | null,
  data: Record<string, unknown>,
  scope: string,
): Generator<AssetCandidate> {
  for (const leaf of dataLeaves(schema, data)) {
    if (leaf.kind === "reference") continue;

    yield { value: leaf.value, where: `${scope} ${leaf.path}`, isImage: leaf.kind === "image" };
  }
}

/**
 * The quoted string literals in a body, without parsing it.
 *
 * Every asset a body can name is written as one: a JSX attribute value, a JSON
 * prop inside an expression attribute, a Markdoc tag argument, a `src` in raw
 * HTML. The component schemas live in the user's `cms.config`, which imports
 * React and cannot be loaded here, so naming a file in the media library is the
 * whole test and a literal that names nothing is simply a lookup miss.
 *
 * The two quote characters are scanned independently, so an apostrophe in prose
 * can cost at most the single-quoted literals after it, never a double-quoted one.
 */
function* quotedStrings(body: string): Generator<string> {
  for (const quote of ['"', "'"]) {
    const parts = body.split(quote);

    for (let i = 1; i < parts.length; i += 2) yield parts[i];
  }
}
