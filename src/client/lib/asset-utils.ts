import { basename, dirname, extname, join, relative } from "pathe";

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

/**
 * Convert a project-root-relative or root-absolute path to a browser-accessible
 * dev URL, prepending the site base path so requests pass Vite's base middleware.
 * "src/assets/photo.jpg" -> "/astronaut-cms/src/assets/photo.jpg"
 */
export function toPreviewUrl(path: string): string {
  return join(import.meta.env.BASE_URL, path);
}

/**
 * Derive a content file path from collection metadata.
 * ("src/content/blog", "hello-world", "mdx") -> "src/content/blog/hello-world.mdx"
 */
export function getContentFilePath(loaderBase: string, entryId: string, format: string): string {
  return join(loaderBase, `${entryId}.${format}`);
}

/** Check if a path points to an image (used by media picker for thumbnail logic). */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Extract the filename from a path, stripping any directory prefix. */
export function getFileName(path: string): string {
  return basename(path);
}
