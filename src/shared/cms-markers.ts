/**
 * The single source of the CMS asset/reference marker factories. A marker is a
 * Zod string tagged with one of the `CMS_*` meta keys from `field-schema.ts`,
 * which `zodToFieldSchema` reads back to produce an image/file/reference field.
 *
 * Used by the public `astronaut-cms/config` helpers (`file`/`link`/`anchor`), the
 * `astro:content` stub (`reference`), and the content-config schema helper bag.
 *
 * In a `content.config.ts` `repoImageMarker` stands in for astro's own schema
 * helper while the integration reads the config in Node: astro's `image()` is
 * what the real build runs, and the marker is only how the admin learns the field
 * takes a repository image. In a `cms.config.ts` the markers are the real thing,
 * since astro has no say over an MDX component's props.
 */
import { z } from "zod";
import type { ResolvedImage } from "../assets/index.ts";
import {
  CMS_IMAGE,
  CMS_FILE,
  CMS_REFERENCE,
  CMS_LINK,
  CMS_ANCHOR,
  CMS_LOCALIZED,
} from "./field-schema.ts";
import { allowedLinks } from "./links.ts";
import { anchorIds } from "./anchors.ts";

/** What a component's `image()` prop is resolved with, `resolveImage` on the site. */
export type ImageResolver = (path: string) => Promise<ResolvedImage>;

/** Astro's collection `image()` as the admin reads it: an image in the repository library alone. */
export const repoImageMarker = () => z.string().meta({ [CMS_IMAGE]: "repo" });

/**
 * A collection image field that takes a file from either media library: an
 * object-store URL as it is, or anything else through astro's own `image()`,
 * which imports a repository file as ever. Typed as what arrives, so rendering a
 * URL where only `ImageMetadata` is handled is a compile error rather than a
 * failed build. The URL is left to astro, which optimizes it as a remote image,
 * and whether it names a library file is checked when content is written.
 *
 * @example
 * ```ts
 * schema: ({ image }) => z.object({ cover: libraryImage(image) })
 * ```
 */
export function libraryImage<T extends z.ZodType>(image: () => T) {
  return z.union([z.url(), image()]).meta({ [CMS_IMAGE]: true });
}

/** A Zod string naming a file in the media library, resolved to a bundled URL. */
export const fileMarker = () => z.string().meta({ [CMS_FILE]: true });

/**
 * A Zod string holding a URL: relative, http, https, mailto or tel. The only
 * field a URL may be written into, since plain text is refused as one. The check
 * is part of the schema itself, so the site's own content validation enforces it
 * too, not only the CMS.
 */
export const linkMarker = () => allowedLinks(z.string()).meta({ [CMS_LINK]: true });

/**
 * A Zod string holding an element id that the component or layout renders, such
 * as a section's `id`. Declaring it is what lets a `#id` link in the same entry
 * be checked, since the CMS cannot tell which prop ends up as an id otherwise.
 */
export const anchorMarker = () => anchorIds(z.string()).meta({ [CMS_ANCHOR]: true });

/**
 * One value per content language, such as a translated title in an otherwise
 * language-neutral entry. Stored as `{ de: "…", en: "…" }` and read with
 * `pickLocale` from `astronaut-cms/content`. The admin edits it in a tab per
 * language, and the default language is required, which the build and every
 * save check, since only the CMS knows the site's languages.
 */
export const localizedMarker = <T extends z.ZodType>(schema: T) =>
  z.record(z.string(), schema).meta({ [CMS_LOCALIZED]: true });

/** A Zod string that references an entry id in another collection. */
export const referenceMarker = (collection: string) =>
  z.string().meta({ [CMS_REFERENCE]: collection });

/**
 * What a component's props function is handed, mirroring the `({ image })` bag
 * astro gives a collection schema. Handing them in rather than exporting them is
 * what keeps an `image()` meant for a component prop out of a `content.config.ts`,
 * where astro's own helper is the only one that resolves.
 */
export function schemaHelpers(resolveImage: ImageResolver) {
  return {
    // A Zod string naming an image in either media library, resolved when the
    // props are parsed. The marker sits on the transform, the side of the pipe
    // that `zodToFieldSchema` lowers. A lambda, since a transform also hands
    // over its context, which `resolveImage` would take for its `base`.
    image: () =>
      z.string().pipe(z.transform((path: string) => resolveImage(path)).meta({ [CMS_IMAGE]: true })),
    file: fileMarker,
    link: linkMarker,
    anchor: anchorMarker,
    localized: localizedMarker,
    reference: referenceMarker,
  };
}
