import config from "@/client/lib/config";
import { libraryDirectories } from "@/shared/media";
import { stripMediaPrefix } from "@/shared/paths";
import { globEntry, singletonEntry, type FileChange } from "@/shared/types";
import { collectionLabel } from "@/client/lib/collections";

/** A changed file mapped back onto the content model the user recognizes. */
export interface DescribedChange extends FileChange {
  /** Collection the file belongs to, when it is a collection entry. */
  collection?: string;
  /** Entry id, for a one-file-per-entry (glob) collection. */
  entryId?: string;
  /** What to show as the change's name. */
  label: string;
}

/**
 * Backends report changes as repository paths, which is the wrong vocabulary for
 * someone who thinks in entries and images. This maps a path back to the
 * collection entry or asset it holds, falling back to the raw path for anything
 * outside the content model.
 */
export function describeChange(change: FileChange): DescribedChange {
  const { path } = change;

  for (const [name, col] of Object.entries(config.collections)) {
    const label = collectionLabel(name);

    if (col.loaderFileName) {
      if (path === col.loaderFileName) return { ...change, collection: name, label };
      continue;
    }

    // Bases may nest, a singleton's often holding other collections, so only a loaded file counts.
    const entry = globEntry(col, path);

    if (entry) {
      return { ...change, collection: name, entryId: entry.id, label: singletonEntry(col) ? label : `${label} / ${entry.id}` };
    }
  }

  const media = libraryDirectories(config.media)
    .map((dir) => stripMediaPrefix(path, dir))
    .find((label) => label != null);

  return { ...change, label: media ?? path };
}
