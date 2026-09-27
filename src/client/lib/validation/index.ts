import { getStorage } from "@client/lib/storage";
import { validatePath } from "@shared/validation";
import type { CollectionManifestEntry } from "@shared/types";
import type { FieldSchema } from "@shared/field-schema";
import { collectResolvableLeaves, type ResolvableLeaf } from "./walk";
import { validateMdx } from "./mdx";
import { error, warning, type Diagnostic } from "./types";

export * from "./types";
export { validateMdx } from "./mdx";

/** An entry id must be a safe, slug-like path (the same rule the storage layer enforces). */
export function validateEntryId(id: string): Diagnostic[] {
  try {
    validatePath(id, "entry id");

    return [];
  } catch (e) {
    return [error(e instanceof Error ? e.message : String(e))];
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

  if (unknown.length) diagnostics.push(error(`Unknown entry id(s): ${unknown.join(", ")}.`));
  if (missing.length) {
    diagnostics.push(
      error(`Every entry must appear exactly once; missing: ${missing.join(", ")}.`),
    );
  }
  if (duplicates.length)
    diagnostics.push(error(`Duplicate entry id(s): ${duplicates.join(", ")}.`));

  return diagnostics;
}

/** A media path must resolve to a file in the media library. */
export async function validateMediaExists(path: string): Promise<Diagnostic[]> {
  const normalized = path.replace(/^\//, "");
  const exists = (await getStorage().listMedia()).some(
    (m) => m.path === normalized || m.path === path,
  );

  return exists ? [] : [error(`No media file at "${path}".`)];
}

async function checkReferences(references: ResolvableLeaf[]): Promise<Diagnostic[]> {
  const byCollection = new Map<string, ResolvableLeaf[]>();

  for (const ref of references) {
    const collection = ref.collection ?? "";
    const list = byCollection.get(collection) ?? [];
    list.push(ref);
    byCollection.set(collection, list);
  }

  const groups = await Promise.all(
    [...byCollection].map(async ([collection, refs]) => {
      const ids = new Set((await getStorage().listEntries(collection)).map((e) => e.id));

      return refs
        .filter((ref) => !ids.has(ref.value))
        .map((ref) =>
          error(
            `references "${ref.value}", which does not exist in collection "${collection}".`,
            ref.path,
          ),
        );
    }),
  );

  return groups.flat();
}

async function checkAssets(assets: ResolvableLeaf[]): Promise<Diagnostic[]> {
  if (assets.length === 0) return [];

  const paths = new Set((await getStorage().listMedia()).map((m) => m.path));

  return assets
    .filter((asset) => !paths.has(asset.value.replace(/^\//, "")))
    .map((asset) =>
      warning(`points at "${asset.value}", which is not in the media library.`, asset.path),
    );
}

/**
 * Cross-resource integrity for the fields the lowered schema can only type as
 * `string`: a `reference` must resolve to an existing entry (error), and an
 * `image`/`file` should resolve to a media file (warning, since assets may live
 * outside the managed media directory). `onlyKeys` restricts the check to the
 * changed top-level fields of a partial edit.
 */
export async function validateReferencesAndAssets(
  schema: FieldSchema | null | undefined,
  data: Record<string, unknown>,
  onlyKeys?: string[],
): Promise<Diagnostic[]> {
  if (schema?.type !== "object") return [];

  const leaves = onlyKeys
    ? onlyKeys.flatMap((key) =>
        schema.shape[key] ? collectResolvableLeaves(schema.shape[key], data[key], key) : [],
      )
    : collectResolvableLeaves(schema, data);

  if (leaves.length === 0) return [];

  const [references, assets] = await Promise.all([
    checkReferences(leaves.filter((l) => l.kind === "reference")),
    checkAssets(leaves.filter((l) => l.kind !== "reference")),
  ]);

  return [...references, ...assets];
}

// --- Entry-write check registry -------------------------------------------

export interface EntryWriteInput {
  col: CollectionManifestEntry;
  id: string;
  data: Record<string, unknown>;
  body: string;
  format: string;
  /** Restrict reference/asset checks to these changed top-level keys (edits). */
  changedDataKeys?: string[];
  /** Skip id validation; an edit keeps its already-valid id. */
  skipId?: boolean;
  /** Skip body validation; an edit that does not touch the body. */
  skipBody?: boolean;
}

/**
 * Ordered checks applied to a pending entry write. To add a validation, append a
 * function returning {@link Diagnostic}s here. They run concurrently and their
 * findings are merged; error-level findings block the write, warnings do not.
 */
export const entryWriteChecks: Array<(input: EntryWriteInput) => Promise<Diagnostic[]>> = [
  async ({ id, skipId }) => (skipId ? [] : validateEntryId(id)),
  async ({ body, format, skipBody }) => (skipBody ? [] : validateMdx(body, format)),
  ({ col, data, changedDataKeys }) =>
    validateReferencesAndAssets(col.schema, data, changedDataKeys),
];

export async function validateEntryWrite(input: EntryWriteInput): Promise<Diagnostic[]> {
  return (await Promise.all(entryWriteChecks.map((check) => check(input)))).flat();
}
