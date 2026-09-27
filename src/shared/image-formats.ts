import type { ImageMetadata } from "astro";
import { extname } from "pathe";

/**
 * astro:assets' input formats. The values have to be written out because astro
 * publishes no runtime export of its `VALID_INPUT_FORMATS` (checked across
 * `astro/assets`, `astro/assets/utils` and `astro/assets/runtime`), and a type
 * cannot be enumerated at run time. What is derived from astro is the
 * *obligation*: `satisfies Record<…, true>` demands a key for every format astro
 * accepts and refuses any it does not, so the mirror cannot drift in either
 * direction without failing the build.
 */
const FORMATS = {
  png: true,
  apng: true,
  jpg: true,
  jpeg: true,
  webp: true,
  avif: true,
  gif: true,
  svg: true,
  tiff: true,
} satisfies Record<ImageMetadata["format"], true>;

export type AstroImageFormat = keyof typeof FORMATS;

/** The same formats as a list, for the dev glob's `{png,jpg,…}` brace pattern. */
export const ASTRO_IMAGE_FORMATS = Object.keys(FORMATS) as AstroImageFormat[];

/** Whether astro:assets can load this path as an image. */
export const isAstroImage = (path: string): boolean =>
  Object.hasOwn(FORMATS, extname(path).slice(1).toLowerCase());
