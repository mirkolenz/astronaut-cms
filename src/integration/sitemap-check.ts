import { readFileSync } from "node:fs";
import { globFiles } from "./content-files.ts";
import { isWithin } from "../server/storage/paths.ts";
import { parseXml } from "../shared/xml.ts";

/**
 * Whether a built sitemap lists a page under `adminPath`. Reading the output
 * rather than the sitemap's options is what honors a `filter`, which is a
 * function the sitemap keeps to itself. A sitemap written after this runs, by
 * an integration listed later, is not seen.
 */
export function sitemapListsAdmin(outDir: string, adminPath: string): boolean {
  return globFiles(outDir, "sitemap-*.xml").some((file) =>
    Array.from(parseXml(readFileSync(file, "utf-8")).getElementsByTagNameNS("*", "loc")).some((element) => {
      const pathname = URL.parse(element.textContent ?? "")?.pathname;

      return pathname !== undefined && isWithin(pathname, adminPath);
    }),
  );
}
