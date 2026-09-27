/**
 * The single source of the CMS asset/reference marker factories. A marker is a
 * Zod string tagged with one of the `CMS_*` meta keys from `field-schema.ts`,
 * which `zodToFieldSchema` reads back to produce an image/file/reference field.
 *
 * Used by the public `astronaut-cms/config` helpers (`image`/`file`), the
 * `astro:content` stub (`reference`), and the content-config schema helper bag.
 */
import { z } from "zod";
import { CMS_IMAGE, CMS_FILE, CMS_REFERENCE } from "./field-schema.ts";

/** A Zod string that resolves to an optimized image asset at render time. */
export const imageMarker = () => z.string().meta({ [CMS_IMAGE]: true });

/** A Zod string that resolves to a bundled file URL at render time. */
export const fileMarker = () => z.string().meta({ [CMS_FILE]: true });

/** A Zod string that references an entry id in another collection. */
export const referenceMarker = (collection: string) =>
  z.string().meta({ [CMS_REFERENCE]: collection });
