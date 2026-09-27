import { validateAgainstSchema } from "../shared/collection-schema.ts";
import { formatDiagnostic } from "../shared/diagnostics.ts";
import type { ContentEntry } from "./content-files.ts";

/**
 * The entries on disk that the admin would refuse to save, their data or their
 * body, one line per finding. A developer can commit anything, but an editor who
 * opens such an entry could not save it again without first removing what they
 * did not write, so the build refuses it where the developer sees it instead.
 */
export function checkContent(entries: ContentEntry[]): string[] {
  return entries.flatMap(({ collection, file, scope, data, body }) => [
    ...validateAgainstSchema(collection, data).map(
      (d) => `${file} (${scope}): ${formatDiagnostic(d)}`,
    ),
    ...(body?.diagnostics ?? []).map((d) => `${file}: ${formatDiagnostic(d)}`),
  ]);
}
