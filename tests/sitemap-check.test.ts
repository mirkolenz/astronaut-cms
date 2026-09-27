import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sitemapListsAdmin } from "@/integration/sitemap-check";

it("finds the admin in a namespaced sitemap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astronaut-sitemap-"));

  try {
    await writeFile(
      join(directory, "sitemap-0.xml"),
      `<urlset xmlns:s="urn:sitemap"><url><s:loc>https://example.com/admin</s:loc></url></urlset>`,
    );

    expect(sitemapListsAdmin(directory, "/admin")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
