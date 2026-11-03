import { existsSync, globSync, readFileSync } from "node:fs";
import { join, relative } from "pathe";
import { getFileExtension, parseContent, parseMultiEntryFile } from "@/shared/content-parser";
import { validateBody, type BodyValidation } from "@/shared/body-validation";
import type { ComponentSchemaMap } from "@/shared/field-schema";
import {
  globEntry,
  globRoots,
  type CollectionManifest,
  type CollectionManifestEntry,
} from "@/shared/types";

/**
 * One entry as it is on disk, parsed and its body walked once for the check
 * that refuses what the admin could not save.
 */
export interface ContentEntry {
  collection: CollectionManifestEntry;
  /** Project-relative path of the file holding the entry. */
  file: string;
  /** Where in the file the data sits: its frontmatter, or an entry of a file collection. */
  scope: string;
  data: Record<string, unknown>;
  /** The walked body, or null for an entry of a file collection, which has none. */
  body: BodyValidation | null;
}

/** Absolute paths of the files matching `patterns`, directories excluded. */
export function globFiles(cwd: string, patterns: string | string[]): string[] {
  if (patterns.length === 0) return [];

  // withFileTypes answers "is this a directory" from the walk itself, so no match
  // costs an extra stat. A cwd that does not exist globs to nothing.
  return globSync(patterns, { cwd, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Project-relative paths of the files a glob collection's loader loads in a
 * format the CMS reads, exactly the ones the storage listing reports. Only the
 * static prefix of each pattern is walked, and no dot directory, whose files
 * astro never loads.
 */
function loadedFiles(rootDir: string, collection: CollectionManifestEntry): string[] {
  return globRoots(collection)
    .flatMap(({ path, file }) =>
      file
        ? [path].filter((literal) => existsSync(join(rootDir, literal)))
        : globFiles(join(rootDir, path), "**/*").map((found) => relative(rootDir, found)),
    )
    .filter((path) => globEntry(collection, path) !== null);
}

/** Every entry of every collection, each file read and each body walked once. */
export function contentEntries(
  rootDir: string,
  collections: CollectionManifest,
  components: ComponentSchemaMap,
): ContentEntry[] {
  const entries: ContentEntry[] = [];

  for (const collection of Object.values(collections)) {
    // A file collection names a literal path, which may contain glob characters.
    const isFile = collection.loaderType === "file";
    const files = isFile
      ? [collection.loaderFileName ?? []].flat().filter((file) => existsSync(join(rootDir, file)))
      : loadedFiles(rootDir, collection);

    for (const file of files) {
      const raw = readFileSync(join(rootDir, file), "utf-8");
      const format = getFileExtension(file);

      // A file collection holds many entries in one file and has no body, so each
      // is named by its id.
      if (isFile) {
        for (const [id, data] of parseMultiEntryFile(raw, format).entries) {
          entries.push({ collection, file, scope: `entry "${id}"`, data, body: null });
        }

        continue;
      }

      const { data, body } = parseContent(raw, format);

      entries.push({
        collection,
        file,
        scope: "frontmatter",
        data,
        body: validateBody(body, format, components),
      });
    }
  }

  return entries;
}
