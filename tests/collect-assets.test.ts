import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectReferencedAssets } from "@integration/collect-assets";
import type { CollectionManifest } from "@shared/types";

// A production build bundles only the assets content can reach, so this pins
// what "reachable" means: a schema field, a string inside an MDX component prop
// or a Markdoc tag, and a relative path resolved against its entry — but never a
// file the library merely happens to hold, and never a string that merely looks
// path-shaped. Only a schema-declared field is held to existing, since nothing
// declared a body string to be a path at all.

const collections: CollectionManifest = {
  pages: {
    name: "pages",
    type: "content",
    loaderType: "glob",
    loaderPattern: "**/*.{md,mdx,mdoc}",
    loaderBase: "src/content/pages",
    loaderFileName: null,
    schema: {
      type: "object",
      shape: {
        title: { type: "string" },
        cover: { type: "image" },
        attachment: { type: "file" },
      },
    },
  },
};

const files: Record<string, string> = {
  "src/assets/hero.png": "hero",
  "src/assets/gallery-1.png": "gallery",
  "src/assets/tag-image.png": "markdoc tag",
  "src/assets/relative-cover.png": "relative",
  "src/assets/orphan.png": "nobody references me",
  "src/assets/brief.pdf": "attached",
  "src/content/pages/home.mdx": `---
title: Home
cover: /src/assets/hero.png
attachment: /src/assets/brief.pdf
---

<Gallery images={[{"src":"/src/assets/gallery-1.png","alt":"one"}]} />

<Link href="/blog/not-an-asset.png" label="./also-not-one.png" />

<Link href="/src/assets/no-such-file.png" />
`,
  "src/content/pages/tagged.mdoc": `---
title: Tagged
---

{% figure src="/src/assets/tag-image.png" /%}
`,
  "src/data/authors.json": `{ "ada": { "name": "Ada", "avatar": "/src/assets/hero.png" } }`,
  "src/content/pages/relative.md": `---
title: Relative
cover: ../../assets/relative-cover.png
---

Body text.
`,
};

let rootDir: string;

function collect(overrides: Partial<Parameters<typeof collectReferencedAssets>[0]> = {}) {
  return collectReferencedAssets({
    rootDir,
    mediaDirectory: "src/assets",
    collections,
    alwaysInclude: [],
    ...overrides,
  });
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "astronaut-cms-assets-"));

  for (const [path, content] of Object.entries(files)) {
    const full = join(rootDir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
});

afterAll(() => rmSync(rootDir, { recursive: true, force: true }));

describe("collectReferencedAssets", () => {
  it("collects frontmatter, nested MDX props and relative paths, and nothing else", () => {
    expect(collect().images).toEqual([
      "/src/assets/gallery-1.png",
      "/src/assets/hero.png",
      "/src/assets/relative-cover.png",
      "/src/assets/tag-image.png",
    ]);
  });

  // An image() names something astro:assets replaces with transformed variants,
  // so keeping a `?url` entry would ship the full-size original for nothing. A
  // prop could still be a file(), since its schema is not readable at build time.
  it("keeps a ?url entry only where resolveFile may be called", () => {
    expect(collect().files).toEqual([
      "/src/assets/brief.pdf",
      "/src/assets/gallery-1.png",
      "/src/assets/tag-image.png",
    ]);
  });

  it.each([
    ["a name no file answers to", "/src/assets/gone.png"],
    ["a path outside the media directory", "/elsewhere/cover.png"],
  ])("fails the build on %s, naming the entry", (_, cover) => {
    const broken = join(rootDir, "src/content/pages/broken.md");
    writeFileSync(broken, `---\ntitle: Broken\ncover: ${cover}\n---\n`);

    expect(collect).toThrow(/src\/content\/pages\/broken\.md \(frontmatter cover\)/);

    rmSync(broken);
  });

  // A file collection holds every entry in one file and is reached by a literal
  // path rather than a pattern, so it is walked entry by entry.
  it("walks the entries of a file collection", () => {
    const authors: CollectionManifest = {
      authors: {
        name: "authors",
        type: "data",
        loaderType: "file",
        loaderPattern: null,
        loaderBase: null,
        loaderFileName: "src/data/authors.json",
        schema: {
          type: "object",
          shape: { name: { type: "string" }, avatar: { type: "image" } },
        },
      },
    };

    expect(collect({ collections: authors }).images).toEqual(["/src/assets/hero.png"]);
  });

  it("bundles alwaysInclude patterns no content references", () => {
    const { images, files } = collect({ alwaysInclude: ["orphan.png"] });

    // Nothing explains what an always-included file is for, so it goes in both.
    expect(images).toContain("/src/assets/orphan.png");
    expect(files).toContain("/src/assets/orphan.png");
  });
});
