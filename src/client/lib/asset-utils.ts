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
 * Resolve a potentially relative path back to project-root-relative.
 * contentFilePath: "src/content/blog/hello.mdx"
 * relativePath: "../../assets/photo.jpg"
 * returns: "src/assets/photo.jpg"
 */
export function resolveAssetPath(contentFilePath: string, relativePath: string): string {
  if (!relativePath.startsWith(".")) return relativePath;
  const contentDir = contentFilePath.split("/").slice(0, -1);
  const parts = relativePath.split("/");
  const result = [...contentDir];
  for (const part of parts) {
    if (part === "..") {
      result.pop();
    } else if (part !== ".") {
      result.push(part);
    }
  }
  return result.join("/");
}

/**
 * Convert project-root-relative path to browser-accessible dev URL.
 * "src/assets/photo.jpg" -> "/src/assets/photo.jpg"
 */
export function toPreviewUrl(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path}`;
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

/**
 * Post-process rendered HTML to fix relative asset paths for dev preview.
 * Uses the browser's native DOMParser.
 */
export function resolvePreviewAssetPaths(html: string, contentFilePath: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (src && !src.startsWith("http") && !src.startsWith("data:")) {
      img.setAttribute("src", toPreviewUrl(resolveAssetPath(contentFilePath, src)));
    }
  }
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("data:")) {
      a.setAttribute("href", toPreviewUrl(resolveAssetPath(contentFilePath, href)));
    }
  }
  return doc.body.innerHTML;
}
