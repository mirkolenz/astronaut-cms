/**
 * Signed read URLs for a media library that is not publicly readable.
 *
 * Reached only from the generated `virtual:astronaut-cms/media-source` module,
 * and therefore only by a site whose library has no `publicUrl`. A prerendered
 * page resolves an image to a URL signed here, astro downloads it while
 * building and emits an optimized asset, and the output refers to the store
 * nowhere. That is why a private library is supported for prerendered content
 * only: an on-demand page would sign one per render and hand a browser a URL
 * that expires.
 *
 * The build runs in Node with the same credentials the deployed route reads, so
 * there is nothing extra to configure.
 */
import serverConfig from "virtual:astronaut-cms/server";
import { readEnv } from "../shared/runtime-env.ts";
import { s3Store } from "./open-store.ts";

// The build is not a request, so there is no runtime context to read through;
// `readEnv` falls back to Node and Deno, which is what a build actually has.
const fromEnvironment = (name: string): string | undefined => readEnv({ locals: {} }, name);

/**
 * One signature per key, not per reference.
 *
 * A signed URL embeds the moment it was signed, so signing the same key twice
 * yields two different strings — and astro identifies a remote image by its src.
 * Without this a logo on forty pages would be forty remote images: forty
 * downloads from the store and forty optimized copies in the output.
 */
const urls = new Map<string, Promise<string>>();

export function presignedMediaUrl(key: string): Promise<string> {
  const cached = urls.get(key);

  if (cached) return cached;

  const url = sign(key);

  urls.set(key, url);

  return url;
}

async function sign(key: string): Promise<string> {
  const { media } = serverConfig;

  if (!media) throw new Error("No object-store media backend is configured.");

  const store = await s3Store(media, fromEnvironment);
  const url = await store.presignDownload(`${media.prefix}${key}`);

  if (!url) throw new Error("This media store cannot sign read URLs.");

  return url;
}
