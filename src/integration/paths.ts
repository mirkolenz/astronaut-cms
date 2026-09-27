import { resolve } from "pathe";

/** Whether `filePath` is `baseDir` itself or lives under it. */
export function isWithin(filePath: string, baseDir: string): boolean {
  const resolved = resolve(filePath);
  const resolvedBase = resolve(baseDir);

  return resolved === resolvedBase || resolved.startsWith(resolvedBase + "/");
}

/** Guards every filesystem path the CMS builds from request or git output. */
export function assertWithinBase(filePath: string, baseDir: string): void {
  if (!isWithin(filePath, baseDir)) {
    throw new Error("Path escapes the allowed directory");
  }
}
