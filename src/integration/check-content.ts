import { existsSync } from "node:fs";
import { join } from "pathe";
import { validateAgainstSchema } from "../shared/collection-schema.ts";
import { formatDiagnostic } from "../shared/diagnostics.ts";
import { mediaPath, repoOnlyRefusal, type ClientMediaConfig } from "../shared/media.ts";
import { dataLeaves } from "../shared/resolvable-leaves.ts";
import type { ContentEntry } from "./content-files.ts";

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
  return entries.flatMap((entry) => [
    ...validateAgainstSchema(entry.collection, entry.data).map(
      (d) => `${entry.file} (${entry.scope}): ${formatDiagnostic(d)}`,
    ),
    ...(entry.body?.diagnostics ?? []).map((d) => `${entry.file}: ${formatDiagnostic(d)}`),
    ...assetProblems(entry, rootDir, media),
  ]);
}

/**
 * Every schema-declared asset has to name a file of the repository library, or
 * a URL under the object store where the field admits one, since a page that
 * renders it would otherwise fail on a path nothing can resolve.
 */
function assetProblems(
  { collection, file, scope, data, body }: ContentEntry,
  rootDir: string,
  media: ClientMediaConfig,
): string[] {
  const leaves = [
    ...dataLeaves(collection.schema, data).map((leaf) => ({ leaf, where: `${scope} ${leaf.path}` })),
    ...(body?.leaves ?? []).map((leaf) => ({ leaf, where: leaf.path })),
  ];

  return leaves.flatMap(({ leaf: { kind, value, repoOnly }, where }) => {
    if (kind === "reference") return [];

    const location = mediaPath(value, media, file);

    if (location?.library === "s3") return repoOnly ? [`${file} (${where}): ${repoOnlyRefusal(value)}`] : [];

    return location && existsSync(join(rootDir, media.repo.directory, location.path))
      ? []
      : [`${file} (${where}): "${value}" is not a file in the media directory ("${media.repo.directory}").`];
  });
}
