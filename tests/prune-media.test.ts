import { existsSync } from "node:fs";
import { join } from "pathe";
import { expect, it } from "vitest";
import { pruneMedia } from "@/integration/prune-media";
import { project } from "./fixtures/project";

it("prunes owned copies and leaves unrelated files with identical bytes", () => {
  const root = project({
    "src/assets/hero.png": "hero",
    "src/assets/used.png": "used",
    "src/assets/report.pdf": "report",
    "dist/_astro/hero.B1x.png": "hero",
    "dist/_astro/hero.B1x_w400.webp": "variant",
    "dist/_astro/used.C2y.png": "used",
    "dist/_astro/report.D3z.pdf": "report",
    "dist/_astro/foreign.E4a.png": "hero",
    "dist/index.html": `<img src="/_astro/hero.B1x_w400.webp"><a href="/_astro/used.C2y.png">`,
  });
  const dist = join(root, "dist");
  const media = join(root, "src/assets");
  const removed = pruneMedia(dist, (path) => path.startsWith(`${media}/`), [
    { fileName: "_astro/report.D3z.pdf", originalFileNames: [join(media, "report.pdf")] },
    { fileName: "_astro/hero.B1x.png", originalFileNames: [join(media, "hero.png")] },
    { fileName: "_astro/foreign.E4a.png", originalFileNames: [] },
  ]);

  expect([...removed.keys()].sort()).toEqual(
    [join(dist, "_astro/report.D3z.pdf"), join(dist, "_astro/hero.B1x.png")].sort(),
  );
  expect(existsSync(join(dist, "_astro/used.C2y.png"))).toBe(true);
  expect(existsSync(join(dist, "_astro/foreign.E4a.png"))).toBe(true);
  expect(existsSync(join(dist, "_astro/hero.B1x_w400.webp"))).toBe(true);
});
