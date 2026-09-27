import type { ImageMetadata } from "astro";

/**
 * astro:assets' input formats (mirrors astro's VALID_INPUT_FORMATS, which has no
 * public runtime export). The `satisfies` rejects any format astro does not accept;
 * the exhaustiveness assertion below rejects the inverse drift — astro gaining an
 * input format this mirror is missing — so the list cannot silently fall behind.
 */
export const ASTRO_IMAGE_FORMATS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "svg",
  "tiff",
] as const satisfies readonly ImageMetadata["format"][];

export type AstroImageFormat = (typeof ASTRO_IMAGE_FORMATS)[number];

type AssertNever<_T extends never> = void;
export type AstroFormatsAreExhaustive = AssertNever<
  Exclude<ImageMetadata["format"], AstroImageFormat>
>;
