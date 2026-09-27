import { basename } from "pathe";

/** Extract the filename from a path, stripping any directory prefix. */
export function getFileName(path: string): string {
  return basename(path);
}
