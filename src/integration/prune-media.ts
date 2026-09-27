import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "pathe";
import { globFiles } from "./content-files.ts";

export interface EmittedAsset {
  fileName: string;
  originalFileNames: string[];
}

/** Delete unlinked outputs whose complete source list belongs to the library. */
export function pruneMedia(
  clientDir: string,
  inLibrary: (path: string) => boolean,
  emitted: readonly EmittedAsset[],
): Map<string, number> {
  const copies = new Map<string, number>();

  for (const asset of emitted) {
    if (asset.originalFileNames.length === 0 || !asset.originalFileNames.every(inLibrary)) continue;

    const path = join(clientDir, asset.fileName);

    if (existsSync(path)) copies.set(path, statSync(path).size);
  }

  if (copies.size === 0) return copies;

  const names = new Map(copies.keys().map((path) => [path, [basename(path), encodeURIComponent(basename(path))]]));

  for (const file of globFiles(clientDir, "**/*.{html,css,js,mjs,json,xml,txt,webmanifest}")) {
    const text = readFileSync(file, "utf-8");

    for (const [path, spellings] of names) {
      if (spellings.some((name) => text.includes(name))) {
        names.delete(path);
        copies.delete(path);
      }
    }

    if (copies.size === 0) return copies;
  }

  for (const path of copies.keys()) rmSync(path);

  return copies;
}
