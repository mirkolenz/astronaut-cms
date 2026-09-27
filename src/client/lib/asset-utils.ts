import { basename, dirname, relative } from "pathe";

/**
 * Compute the path of an asset relative to a content file's directory.
 * ("src/content/blog/hello.mdx", "src/assets/photo.jpg") -> "../../assets/photo.jpg"
 */
export function toRelativeAssetPath(contentFilePath: string, assetPath: string): string {
  return relative(dirname(contentFilePath), assetPath);
}

/** Extract the filename from a path, stripping any directory prefix. */
export function getFileName(path: string): string {
  return basename(path);
}
