import { extname, join, relative } from "pathe";
// The `.js` extension, since picomatch has no exports map for node to resolve the subpath with.
import picomatch from "picomatch/posix.js";
import { slug } from "github-slugger";
import { getFileExtension } from "@/shared/content-parser";
import type { FieldSchema } from "@/shared/field-schema";
import { joinLocale, type ContentI18n } from "@/shared/i18n";
import { projectPath } from "@/shared/paths";

export const CONTENT_FORMATS = ["md", "mdx", "mdoc"] as const;
export const DATA_FORMATS = ["json", "yaml", "yml", "toml"] as const;
export const ALL_FORMATS = [...CONTENT_FORMATS, ...DATA_FORMATS] as const;
/** Compiles only when `T` is `never`: the drift checks against astro and the editor. */
export type AssertNever<_T extends never> = void;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type DataFormat = (typeof DATA_FORMATS)[number];
export type EntryFormat = (typeof ALL_FORMATS)[number];

/** A file extension as one of the formats the CMS knows, or null for anything else. */
export function asEntryFormat(value: string): EntryFormat | null {
  return (ALL_FORMATS as readonly string[]).includes(value) ? (value as EntryFormat) : null;
}

export type CollectionType = "content" | "data";
export type StorageType = "local" | "github" | "gitlab";
export type FileEntryLayout = "array" | "object";
export type LoaderType = "glob" | "file";

/**
 * How a collection's entries are ordered, for the site (see
 * `astronaut-cms/content`) and in the admin alike.
 *
 * - `id`: by id, as astro's content store returns them.
 * - `natural`: by id, with digit runs compared as numbers (`2` before `10`).
 * - `file`: in the order the file of a `file()` collection holds them, which the
 *   admin then lets editors change.
 */
export type CollectionSort = "id" | "natural" | "file";

const naturalCollator = new Intl.Collator(undefined, { numeric: true });

/**
 * Compares two entry ids under `sort`. File order is no order of ids, so it
 * compares them as astro does, for whatever the file does not place.
 */
export function compareIds(sort: CollectionSort): (a: string, b: string) => number {
  return sort === "natural"
    ? (a, b) => naturalCollator.compare(a, b)
    : (a, b) => a.localeCompare(b);
}

/** Entries by id under `sort`, or as given for file order, which the listing already is. */
export function sortByIds<E extends { id: string }>(
  entries: readonly E[],
  sort: CollectionSort,
): E[] {
  if (sort === "file") return [...entries];

  const compare = compareIds(sort);

  return entries.toSorted((a, b) => compare(a.id, b.id));
}

/**
 * Fully-resolved description of one content collection, extracted from the
 * user's `content.config.ts` in Node and serialized into the admin bundle.
 */
export interface CollectionManifestEntry {
  name: string;
  type: CollectionType;
  schema: FieldSchema | null;
  loaderType: LoaderType;
  loaderPattern: string | string[] | null;
  /** Where a `glob()` loader reads from, `""` for the project root, null for any other loader. */
  loaderBase: string | null;
  loaderFileName: string | null;
  sort: CollectionSort;
  /** The files of a singleton, see {@link findSingleton}, null for any other collection. */
  singleton: Singleton | null;
  label?: string;
  description?: string;
}

export type CollectionManifest = Record<string, CollectionManifestEntry>;

/** A file a glob collection's loader loads, under the id astro gives it. */
export interface GlobEntry {
  id: string;
  format: EntryFormat;
  /** Project-relative path of the file. */
  path: string;
}

/** The files of a singleton collection, see {@link findSingleton}. */
export interface Singleton {
  /** Its one file, or the default language's, which the site cannot do without. */
  main: GlobEntry;
  /** The other languages' files of a localized singleton, which fall back to `main`. */
  translations: GlobEntry[];
}

/** Where a walk for a glob collection's files has to look, see {@link globRoots}. */
export interface GlobRoot {
  /** Project-relative, `""` for the project root. */
  path: string;
  /** Whether this is the one file a literal pattern names rather than a directory. */
  file: boolean;
}

/** `derive` cached per manifest entry, which never changes once loaded. */
function perCollection<C extends object, R extends object>(derive: (col: C) => R): (col: C) => R {
  const cache = new WeakMap<C, R>();

  return (col) => {
    const cached = cache.get(col);

    if (cached !== undefined) return cached;

    const value = derive(col);

    cache.set(col, value);

    return value;
  };
}

/**
 * The files of a singleton, whose loader can only ever load the files it names,
 * so the admin edits them directly and nothing may add, rename or remove one,
 * which would only write a file the site never reads. That is the one file a
 * literal pattern names, or, with content languages, one file per language for
 * a pattern that is a language folder followed by a literal file, such as
 * `*\/site.yaml`. Null for any other collection. Resolved once into the
 * manifest, as {@link CollectionManifestEntry.singleton}.
 */
export function findSingleton(
  col: Pick<CollectionManifestEntry, "loaderType" | "loaderPattern" | "loaderBase">,
  i18n: ContentI18n | null,
): Singleton | null {
  const patterns = loaderPatterns(col);
  const [pattern] = patterns;

  if (col.loaderType !== "glob" || patterns.length !== 1 || !pattern) return null;

  const [root] = globRoots(col);

  if (root?.file) {
    const main = globEntry(col, root.path);

    return main && { main, translations: [] };
  }

  const slash = pattern.indexOf("/");
  const file = pattern.slice(slash + 1);

  if (!i18n || slash < 0 || picomatch.scan(file, { unescape: true }).isGlob) return null;

  const entryIn = (locale: string) =>
    globEntry(col, projectPath(collectionBase(col), joinLocale(locale, file)));
  const main = entryIn(i18n.defaultLocale);
  const translations = i18n.locales.filter((locale) => locale !== i18n.defaultLocale).map(entryIn);

  return main && translations.every((entry) => entry !== null) ? { main, translations } : null;
}

/** The ids of a singleton's entries, the main one first, none for any other collection. */
export const singletonIds = ({
  singleton,
}: Pick<CollectionManifestEntry, "singleton">): string[] =>
  singleton ? [singleton.main, ...singleton.translations].map((entry) => entry.id) : [];

// Astro's glob loader skips its legacy content config wherever a pattern matches it.
const ASTRO_CONFIG_FILES = new Set(["js", "ts", "mjs"].map((ext) => `src/content/config.${ext}`));

/** A glob collection's patterns, none for a loader that is neither `glob()` nor `file()`. */
export function loaderPatterns(col: Pick<CollectionManifestEntry, "loaderPattern">): string[] {
  return [col.loaderPattern ?? []].flat();
}

/**
 * Whether astro's `glob()` loader of `col` loads a project-relative `path`,
 * decided as astro decides it: `!` patterns ignore what the others match, and
 * dotfiles and paths outside the base never match.
 */
export const globMatcher = perCollection(
  (
    col: Pick<CollectionManifestEntry, "loaderPattern" | "loaderBase">,
  ): ((path: string) => boolean) => {
    const patterns = loaderPatterns(col);
    const ignore = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
    const isMatch = picomatch(
      patterns.filter((p) => !p.startsWith("!")),
      ignore.length > 0 ? { ignore } : undefined,
    );
    const base = collectionBase(col);

    return (path) => {
      const entry = relative(base, path);

      return !entry.startsWith("../") && !ASTRO_CONFIG_FILES.has(path) && isMatch(entry);
    };
  },
);

/**
 * Where a walk for a glob collection's files has to look: the static prefix of
 * each pattern, a directory to descend into or, for a literal pattern, the one
 * file it names. None lies inside another.
 */
export function globRoots(
  col: Pick<CollectionManifestEntry, "loaderPattern" | "loaderBase">,
): GlobRoot[] {
  const roots = loaderPatterns(col)
    .filter((p) => !p.startsWith("!"))
    .map((p) => {
      const { base, isGlob } = picomatch.scan(p, { unescape: true });

      return { path: projectPath(collectionBase(col), base), file: !isGlob };
    });

  return roots.filter(
    (root, index) =>
      roots.findIndex((other) => other.path === root.path) === index &&
      !roots.some((dir) => dir.path !== root.path && inGlobRoot(root.path, dir)),
  );
}

/** Whether a walk from `root` reaches the project-relative `path`. */
export function inGlobRoot(path: string, root: GlobRoot): boolean {
  return root.file ? path === root.path : root.path === "" || path.startsWith(`${root.path}/`);
}

/**
 * The id astro's default `generateId` gives the file at the base-relative
 * `entry`: the `slug` its data sets, or else its path without the extension,
 * each segment slugged and a trailing `/index` dropped.
 */
function astroEntryId(entry: string, data?: Record<string, unknown>): string {
  // Astro stringifies whatever the slug holds.
  // oxlint-disable-next-line no-base-to-string
  if (data?.slug) return String(data.slug);

  return entry
    .slice(0, entry.length - extname(entry).length)
    .split("/")
    .map((segment) => slug(segment))
    .join("/")
    .replace(/\/index$/, "");
}

/** The id astro gives the entry in a glob collection's project-relative `path`, holding `data`. */
export function globEntryId(
  col: Pick<CollectionManifestEntry, "loaderBase">,
  path: string,
  data?: Record<string, unknown>,
): string {
  return astroEntryId(relative(collectionBase(col), path), data);
}

/**
 * The entry a glob collection's loader makes of the file at the project-relative
 * `path`, or null for a file it does not load or the CMS cannot read. The one
 * rule the storage listing, the changeset and the build map files with.
 */
export function globEntry(
  col: Pick<CollectionManifestEntry, "loaderPattern" | "loaderBase">,
  path: string,
): GlobEntry | null {
  const format = asEntryFormat(getFileExtension(path));

  return format && globMatcher(col)(path) ? { id: globEntryId(col, path), format, path } : null;
}

/**
 * Project-relative directory a glob collection's loader reads from, the
 * project root (`""`) as astro defaults it.
 */
export function collectionBase(col: Pick<CollectionManifestEntry, "loaderBase">): string {
  return col.loaderBase ?? "";
}

/**
 * Project-relative path of the file an entry's content goes to: the shared
 * container in a file collection, and in a glob collection the file a literal
 * pattern names for its id or else the id with the format's extension, whose
 * astro id is the id itself whenever the id is slugged already. An existing
 * entry's file is the one the listing reports, which astro may name differently.
 */
export function entryFilePath(
  collection: CollectionManifestEntry,
  id: string,
  format: string,
): string {
  if (collection.loaderType === "file" && collection.loaderFileName) {
    return collection.loaderFileName;
  }

  const literal = globRoots(collection).find(
    (root) =>
      root.file &&
      getFileExtension(root.path) === format &&
      globEntryId(collection, root.path) === id,
  );

  return literal?.path ?? join(collectionBase(collection), `${id}.${format}`);
}

export interface EntryMeta {
  id: string;
  collection: string;
  format: EntryFormat;
  /** Project-relative path of the file holding the entry. */
  path: string;
}

/** A file collection's container, as the admin needs to know it. */
export interface FileCollectionInfo {
  layout: FileEntryLayout;
  /**
   * The container's version, which every entry in it shares. Reordering is a
   * rewrite of the whole file, so this is what a reorder is based on.
   */
  version?: string;
}

export interface EntryContent {
  id: string;
  /** Project-relative path of the file holding the entry. */
  path: string;
  data: Record<string, unknown>;
  body: string;
  format: EntryFormat;
  /**
   * What this read saw, as the backend names it. Opaque, and the only thing a
   * caller may do with it is hand it back to the save that follows (see
   * {@link SaveEntryRequest.expectedVersion}).
   */
  version?: string;
}

export interface SaveEntryRequest {
  data: Record<string, unknown>;
  body: string;
  format: EntryFormat;
  /** Refuse the write if the entry already exists. */
  createOnly?: boolean;
  /**
   * The {@link EntryContent.version} this edit was made against, so a write
   * cannot silently discard one that landed while the editor was open. Absent
   * means "whatever is there now", which is what a write with nothing to compare
   * against can honestly claim.
   *
   * Deliberately opaque: it is compared, never dereferenced, so it stays a token
   * the caller echoes back rather than the repository ref that the operation
   * registry exists to keep out of a caller's hands.
   */
  expectedVersion?: string;
}

/** One file in the media library, addressed relative to the library root. */
export interface MediaFile {
  path: string;
  size: number;
  /**
   * What this file's contents are, as the backend names them: the blob hash for
   * a repository library. It makes the file's URL change when the bytes do,
   * which is what lets the admin cache one forever instead of asking the server
   * again for every thumbnail. Absent for a library whose backend has no such
   * name, and then the URL is simply cached for minutes rather than for good.
   */
  version?: string;
}

/**
 * A deletion that can still be undone. Only an object-store library has these: a
 * repository library's deletions are a commit on the draft branch, which git
 * keeps whether or not the CMS does.
 */
export interface TrashedFile {
  /** Opaque to the caller, and what restoring or purging addresses. */
  id: string;
  /** Where restoring would put it back. */
  path: string;
  size: number;
  /** Epoch milliseconds the file was deleted. */
  deletedAt: number;
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

/** One changed file in the pending changeset, with its unified diff when available. */
export interface FileChange {
  path: string;
  kind: ChangeKind;
  /** Previous path, for a rename. */
  previousPath?: string;
  /** Unified diff hunks, omitted for binary files and when no diff can be produced. */
  patch?: string;
  /** Identifies the file's new state when there is no patch to tell versions apart. */
  version?: string;
}

// Extracts allowed file extensions from loader metadata.
// Handles glob patterns (e.g. "**/*.{md,mdx}") and file loader filenames (e.g. "data.json").
// Returns null if no extensions can be determined.
export function extractFormatsFromLoader(
  pattern: string | string[] | null,
  fileName: string | null,
): string[] | null {
  if (fileName != null) {
    const ext = getFileExtension(fileName);

    return ext ? [ext] : null;
  }

  const formats = new Set(
    loaderPatterns({ loaderPattern: pattern })
      .flatMap((p) => {
        const ext = getFileExtension(p.trim());

        // A brace list such as `*.{md,mdx}` names several.
        return ext.startsWith("{") && ext.endsWith("}") ? ext.slice(1, -1).split(",") : [ext];
      })
      .map((format) => format.trim())
      .filter(Boolean),
  );

  return formats.size > 0 ? [...formats] : null;
}
