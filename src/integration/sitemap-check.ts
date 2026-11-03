import { readFileSync } from "node:fs";
import { z } from "zod";
import { globFiles } from "@/integration/content-files";
import { isWithin } from "@/server/storage/paths";
import { parseXml, xmlList } from "@/shared/xml";

/** A page sitemap. An index lists sitemaps rather than pages, so it reads as empty. */
const Sitemap = z.object({
  urlset: z.object({ url: xmlList(z.object({ loc: z.string() })) }).optional(),
});

/**
 * Whether a built sitemap lists a page under `adminPath`. Reading the output
 * rather than the sitemap's options is what honors a `filter`, which is a
 * function the sitemap keeps to itself. A sitemap written after this runs, by
 * an integration listed later, is not seen.
 */
export function sitemapListsAdmin(outDir: string, adminPath: string): boolean {
  return globFiles(outDir, "sitemap-*.xml").some((file) =>
    (parseXml(readFileSync(file, "utf-8"), Sitemap).urlset?.url ?? []).some(({ loc }) => {
      const pathname = URL.parse(loc.trim())?.pathname;

      return pathname !== undefined && isWithin(pathname, adminPath);
    }),
  );
}
