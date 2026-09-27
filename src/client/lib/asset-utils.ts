import { basename, dirname, extname, relative } from "pathe";

// Browser-renderable image extensions for <img> thumbnails in the media picker.
// Deliberately not astro's input list: excludes tiff (browsers can't display it).
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"]);

/**
 * Compute the path of an asset relative to a content file's directory.
 * ("src/content/blog/hello.mdx", "src/assets/photo.jpg") -> "../../assets/photo.jpg"
 */
export function toRelativeAssetPath(contentFilePath: string, assetPath: string): string {
  return relative(dirname(contentFilePath), assetPath);
}

/** Check if a path points to an image (used by media picker for thumbnail logic). */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Extract the filename from a path, stripping any directory prefix. */
export function getFileName(path: string): string {
  return basename(path);
}
