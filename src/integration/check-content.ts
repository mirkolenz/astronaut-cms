import { statSync } from "node:fs";
import { join } from "pathe";
import { diagnostic, formatDiagnostic, type Diagnostic } from "../shared/diagnostics.ts";
import { getFileExtension } from "../shared/content-parser.ts";
import { mediaPath, repoOnlyRefusal, type ClientMediaConfig } from "../shared/media.ts";
import { libraryPathError } from "../shared/validation.ts";
import { isAsset, type ResolvableLeaf } from "../shared/resolvable-leaves.ts";
import { checkEntry } from "../shared/entry-checks.ts";
import { ASTRO_IMAGE_FORMATS } from "../shared/image-formats.ts";
import type { ContentEntry } from "./content-files.ts";
import { singletonEntry, type CollectionManifest } from "../shared/types.ts";

/**
 * The entries on disk that the admin would refuse to save, their data or their
 * body, one line per finding. A developer can commit anything, but an editor who
 * opens such an entry could not save it again without first removing what they
 * did not write, so the build refuses it where the developer sees it instead.
 */
export function checkContent(
  entries: ContentEntry[],
  rootDir: string,
  media: ClientMediaConfig,
): string[] {
  return entries.flatMap(({ collection, file, scope, data, body }) => {
    const { diagnostics, leaves } = checkEntry(collection, { path: file, data, body });
    // A file collection holds many entries in one file, so its findings name the entry.
    const where = body ? file : `${file} (${scope})`;

    return [...diagnostics, ...assetProblems(leaves, file, rootDir, media)].map(
      (d) => `${where}: ${formatDiagnostic(d)}`,
    );
  });
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

/**
 * Every schema-declared asset has to name a file of the repository library, or
 * a URL under the object store where the field admits one, since a page that
 * renders it would otherwise fail on a path nothing can resolve.
 */
function assetProblems(
  leaves: ResolvableLeaf[],
  file: string,
  rootDir: string,
  media: ClientMediaConfig,
): Diagnostic[] {
  return leaves.filter(isAsset).flatMap(({ kind, value, repoOnly, path }) => {
    const location = mediaPath(value, media, file);

    if (location?.library === "s3") return repoOnly ? [diagnostic(repoOnlyRefusal(value), path)] : [];

    const key = location?.path;
    const resolvable =
      key !== undefined &&
      libraryPathError(key, media.repo.extensions) === null &&
      isRegularFile(join(rootDir, media.repo.directory, key)) &&
      (kind !== "image" || ASTRO_IMAGE_FORMATS.some((format) => format === getFileExtension(key)));

    return resolvable
      ? []
      : [diagnostic(`"${value}" cannot be resolved as a ${kind} in the media directory ("${media.repo.directory}").`, path)];
  });
}

/**
 * Every singleton whose one file is missing. The site reads that entry by its
 * id, so a build without it would fail there instead, less legibly.
 */
export function missingSingletons(collections: CollectionManifest, entries: ContentEntry[]): string[] {
  return Object.values(collections).flatMap((collection) => {
    const singleton = singletonEntry(collection);

    if (!singleton || entries.some((entry) => entry.collection.name === collection.name)) return [];

    return [`${singleton.path}: the singleton collection "${collection.name}" needs this file, its only entry.`];
  });
}
