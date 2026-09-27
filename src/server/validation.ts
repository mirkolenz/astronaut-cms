import config from "virtual:astronaut-cms/config";
import { collectionDataSchema, normalizeDates } from "@/shared/collection-schema";
import { validatePath } from "@/shared/validation";
import { describeMediaRef, mediaPath } from "@/shared/media";
import { entryFilePath, type CollectionManifestEntry } from "@/shared/types";
import { dataLeaves, type ResolvableLeaf } from "@/shared/resolvable-leaves";
import { components } from "virtual:astronaut-cms/user-config";
import { validateBody } from "@/shared/body-validation";
import { diagnostic, ContentValidationError, type Diagnostic } from "@/shared/diagnostics";

/**
 * What the checks need to look things up. The storage backend is passed in
 * rather than taken from `getStorage()` so that the backend itself can validate
 * its own writes without depending on the module that constructs it.
 */
export interface MediaSource {
  listMedia(): Promise<{ path: string }[]>;
}

export interface ContentSource extends MediaSource {
  listEntries(collection: string): Promise<{ id: string }[]>;
}

/** Every library path the backend reports, as the checks below compare against it. */
async function libraryPaths(source: MediaSource): Promise<Set<string>> {
  return new Set((await source.listMedia()).map((m) => m.path));
}

/** An entry id must be a safe, slug-like path (the same rule the storage layer enforces). */
function validateEntryId(id: string): Diagnostic[] {
  try {
    validatePath(id, "entry id");

    return [];
  } catch (e) {
    return [diagnostic(e instanceof Error ? e.message : String(e))];
  }
}

/** A reorder must list every existing id exactly once: no unknown, missing, or duplicate ids. */
export function validateReorder(existing: string[], ids: string[]): Diagnostic[] {
  const existingSet = new Set(existing);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicates: string[] = [];

  for (const id of ids) {
    if (!existingSet.has(id)) unknown.push(id);
    if (seen.has(id)) duplicates.push(id);

    seen.add(id);
  }

  const missing = existing.filter((id) => !seen.has(id));
  const diagnostics: Diagnostic[] = [];

  if (unknown.length) diagnostics.push(diagnostic(`Unknown entry id(s): ${unknown.join(", ")}.`));
  if (missing.length) {
    diagnostics.push(
      diagnostic(`Every entry must appear exactly once; missing: ${missing.join(", ")}.`),
    );
  }
  if (duplicates.length)
    diagnostics.push(diagnostic(`Duplicate entry id(s): ${duplicates.join(", ")}.`));

  return diagnostics;
}

async function checkReferences(
  source: ContentSource,
  references: ResolvableLeaf[],
): Promise<Diagnostic[]> {
  const byCollection = new Map<string, ResolvableLeaf[]>();

  for (const ref of references) {
    const collection = ref.collection ?? "";
    const list = byCollection.get(collection) ?? [];
    list.push(ref);
    byCollection.set(collection, list);
  }

  const groups = await Promise.all(
    [...byCollection].map(async ([collection, refs]) => {
      const ids = new Set((await source.listEntries(collection)).map((e) => e.id));

      return refs
        .filter((ref) => !ids.has(ref.value))
        .map((ref) =>
          diagnostic(
            `references "${ref.value}", which does not exist in collection "${collection}".`,
            ref.path,
          ),
        );
    }),
  );

  return groups.flat();
}

/**
 * An `image`/`file` field must name a file in the media library, and nothing
 * else. This is not a house rule: the site resolves these values through the
 * library alone — a map rooted at the media directory, or a URL under the
 * configured public base (see `virtual:astronaut-cms/assets`) — so a value that
 * addresses anything else cannot resolve at render time no matter what the file
 * system or the bucket holds. With a repository library a build takes it
 * further and refuses to start, since the same walk decides what is bundled.
 */
async function checkAssets(
  source: MediaSource,
  assets: ResolvableLeaf[],
  base?: string,
): Promise<Diagnostic[]> {
  if (assets.length === 0) return [];

  const paths = await libraryPaths(source);

  return assets.flatMap((asset) => {
    const path = mediaPath(asset.value, config, base);

    if (path == null) {
      return diagnostic(
        `"${asset.value}" does not address the media library. An asset value must be ${describeMediaRef(config)}; upload the file there and use the path the media library reports.`,
        asset.path,
      );
    }

    if (!paths.has(path)) {
      return diagnostic(
        `"${asset.value}" is not in the media library. Use a path the media library reports.`,
        asset.path,
      );
    }

    return [];
  });
}

/**
 * The data must satisfy the collection's own schema. Writing an entry that does
 * not is the one CMS mistake the site cannot survive: Astro's content sync
 * throws on it, and the full sync it runs at startup is uncaught, so the dev
 * server exits and will not come back until the file is fixed by hand.
 *
 * The reconstructed schema is never stricter than the original (see
 * `fieldSchemaToZod`), so this catches every structural violation while never
 * blocking a write the real schema would have accepted.
 */
export function validateAgainstSchema(
  col: CollectionManifestEntry,
  data: Record<string, unknown>,
): Diagnostic[] {
  const result = collectionDataSchema(col).safeParse(normalizeDates(data));

  if (result.success) return [];

  return result.error.issues.map((issue) =>
    diagnostic(issue.message, issue.path.join(".") || undefined),
  );
}

/**
 * Cross-resource integrity for the fields the lowered schema can only type as
 * `string`: a `reference` must resolve to an existing entry and an `image`/`file`
 * to a file in the media library. These are the values a model can get past the
 * tool's JSON Schema while still pointing at nothing, so they are checked here
 * rather than by the schema.
 */
async function checkResolvableLeaves(
  source: ContentSource,
  leaves: ResolvableLeaf[],
  base?: string,
): Promise<Diagnostic[]> {
  if (leaves.length === 0) return [];

  const [references, assets] = await Promise.all([
    checkReferences(
      source,
      leaves.filter((l) => l.kind === "reference"),
    ),
    checkAssets(
      source,
      leaves.filter((l) => l.kind !== "reference"),
      base,
    ),
  ]);

  return [...references, ...assets];
}

// --- Entry writes ----------------------------------------------------------

export interface EntryWrite {
  col: CollectionManifestEntry;
  id: string;
  data: Record<string, unknown>;
  body: string;
  format: string;
}

/**
 * Everything that has to hold before an entry may be written: a slug-safe id,
 * data matching the collection's schema, a body within the allowed subset, and every
 * asset and reference — from the frontmatter and from the component props alike
 * — resolving to something that exists. The two leaf sources are resolved
 * together so the media library and each referenced collection are listed once
 * per write.
 */
async function validateEntryWrite(
  source: ContentSource,
  { col, id, data, body, format }: EntryWrite,
): Promise<Diagnostic[]> {
  const parsed = validateBody(body, format, components);

  return [
    ...validateEntryId(id),
    ...validateAgainstSchema(col, data),
    ...parsed.diagnostics,
    ...(await checkResolvableLeaves(
      source,
      [...dataLeaves(col.schema, data), ...parsed.leaves],
      entryFilePath(col, id, format),
    )),
  ];
}

/** Throws {@link ContentValidationError} unless the entry is safe to write. */
export async function assertEntryWritable(source: ContentSource, write: EntryWrite): Promise<void> {
  const diagnostics = await validateEntryWrite(source, write);

  if (diagnostics.length > 0) throw new ContentValidationError(diagnostics);
}
