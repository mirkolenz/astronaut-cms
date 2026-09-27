/**
 * The single source of the CMS asset/reference marker factories. A marker is a
 * Zod string tagged with one of the `CMS_*` meta keys from `field-schema.ts`,
 * which `zodToFieldSchema` reads back to produce an image/file/reference field.
 *
 * Used by the public `astronaut-cms/config` helpers (`image`/`file`), the
 * `astro:content` stub (`reference`), and the content-config schema helper bag.
 *
 * In a `content.config.ts` `imageMarker` stands in for astro's own schema helper
 * while the integration reads the config in Node: astro's `image()` is what the
 * real build runs, and the marker is only how the admin learns the field takes an
 * image. In a `cms.config.ts` the markers are the real thing, since astro has no
 * say over an MDX component's props.
 */
import { z } from "zod";
import { CMS_IMAGE, CMS_FILE, CMS_REFERENCE, CMS_LINK } from "./field-schema.ts";
import { allowedLinks } from "./links.ts";

/** A Zod string naming an image in the media library. */
export const imageMarker = () => z.string().meta({ [CMS_IMAGE]: true });

/** A Zod string naming a file in the media library, resolved to a bundled URL. */
export const fileMarker = () => z.string().meta({ [CMS_FILE]: true });

/**
 * A Zod string holding a URL: relative, http, https, mailto or tel. The only
 * field a URL may be written into, since plain text is refused as one. The check
 * is part of the schema itself, so the site's own content validation enforces it
 * too, not only the CMS.
 */
export const linkMarker = () => allowedLinks(z.string()).meta({ [CMS_LINK]: true });

/** A Zod string that references an entry id in another collection. */
export const referenceMarker = (collection: string) =>
  z.string().meta({ [CMS_REFERENCE]: collection });

/**
 * What a component's props function is handed, mirroring the `({ image })` bag
 * astro gives a collection schema. Handing them in rather than exporting them is
 * what keeps an `image()` meant for a component prop out of a `content.config.ts`,
 * where astro's own helper is the only one that resolves.
 */
export const schemaHelpers = { image: imageMarker, file: fileMarker, link: linkMarker };
