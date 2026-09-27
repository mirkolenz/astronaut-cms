const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

/**
 * Compute relative path from a content file to any asset.
 * contentFilePath: "src/content/blog/hello.mdx"
 * assetPath: "src/assets/photo.jpg"
 * returns: "../../assets/photo.jpg"
 */
export function toRelativeAssetPath(contentFilePath: string, assetPath: string): string {
  const contentParts = contentFilePath.split("/").slice(0, -1); // directory of content file
  const assetParts = assetPath.split("/");

  // Find common prefix length
  let common = 0;
  while (
    common < contentParts.length &&
    common < assetParts.length &&
    contentParts[common] === assetParts[common]
  ) {
    common++;
  }

  const ups = contentParts.length - common;
  const remaining = assetParts.slice(common);
  return [...Array<string>(ups).fill(".."), ...remaining].join("/");
}

/**
 * Convert project-root-relative path to browser-accessible dev URL.
 * Prepends the site base path so requests pass Vite's base middleware.
 * "src/assets/photo.jpg" -> "/astronaut-cms/src/assets/photo.jpg"
 */
export function toPreviewUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}

/**
 * Derive content file path from collection metadata.
 * loaderBase: "src/content/blog", entryId: "hello-world", format: "mdx"
 * returns: "src/content/blog/hello-world.mdx"
 */
export function getContentFilePath(loaderBase: string, entryId: string, format: string): string {
  const base = loaderBase.replace(/\/$/, "");
  return `${base}/${entryId}.${format}`;
}

/** Check if a path points to an image (used by media picker for thumbnail logic). */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path);
}

/** Extract the filename from a path, stripping any directory prefix. */
export function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}
