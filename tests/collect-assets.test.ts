import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectReferencedAssets } from "@integration/collect-assets";
import type { ComponentSchemaMap } from "@shared/field-schema";
import type { CollectionManifest } from "@shared/types";

// A production build bundles only the assets content can reach, and every one of
// them is reached through a schema: a collection field or a declared MDX
// component prop. This pins that rule, in both directions. A string is collected
// because its schema says it is an asset, never because it looks like a path,
// and a collection's `image()` is left out entirely, since astro imports those
// into `entry.data` itself.

const collections: CollectionManifest = {
  pages: {
    name: "pages",
    type: "content",
    loaderType: "glob",
    loaderPattern: "**/*.{md,mdx}",
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

const components: ComponentSchemaMap = {
  Gallery: {
    props: {
      type: "object",
      shape: {
        images: {
          type: "array",
          element: {
            type: "object",
            shape: { src: { type: "image" }, alt: { type: "string" } },
          },
        },
      },
    },
  },
  Download: {
    props: { type: "object", shape: { file: { type: "file" }, label: { type: "string" } } },
  },
  // Nothing about `href` says "asset", so a path-shaped value is left alone.
  Link: { props: { type: "object", shape: { href: { type: "string" } } } },
};

const files: Record<string, string> = {
  "src/assets/hero.png": "frontmatter image, astro's to import",
  "src/assets/gallery-1.png": "an image prop",
  "src/assets/relative-cover.png": "an image prop written relatively",
  "src/assets/orphan.png": "nobody references me",
  "src/assets/brief.pdf": "a file() field",
  "src/assets/manual.pdf": "a file prop",
  "src/content/pages/home.mdx": `---
title: Home
cover: /src/assets/hero.png
attachment: /src/assets/brief.pdf
---

A file named "/src/assets/orphan.png" is prose, not a reference.

<Gallery
  images={[{"src":"/src/assets/gallery-1.png","alt":"one"},{"src":"../../assets/relative-cover.png","alt":"two"}]}
/>

<Download file="/src/assets/manual.pdf" label="Manual" />

<Link href="/src/assets/orphan.png" />
`,
  "src/data/authors.json": `{ "ada": { "name": "Ada", "portrait": "/src/assets/brief.pdf" } }`,
};

let rootDir: string;

function collect(overrides: Partial<Parameters<typeof collectReferencedAssets>[0]> = {}) {
  return collectReferencedAssets({
    rootDir,
    mediaDirectory: "src/assets",
    collections,
    components,
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
  // The frontmatter `cover` is deliberately absent: astro's own `image()` import
  // covers it, so bundling it here would ship a second copy.
  it("collects the image props of MDX components, relative paths included", () => {
    expect(collect().images).toEqual([
      "/src/assets/gallery-1.png",
      "/src/assets/relative-cover.png",
    ]);
  });

  // An `image()` names something astro:assets replaces with transformed variants,
  // so a `?url` entry for it would ship the full-size original for nothing. Only
  // what a `file()` declares gets one.
  it("keeps a ?url entry only where resolveFile may be called", () => {
    expect(collect().files).toEqual(["/src/assets/brief.pdf", "/src/assets/manual.pdf"]);
  });

  it.each([
    [
      "a frontmatter field",
      "broken.md",
      "---\ntitle: Broken\ncover: /src/assets/gone.png\n---\n",
      /broken\.md \(frontmatter cover\)/,
    ],
    [
      "a component prop",
      "broken.mdx",
      '---\ntitle: Broken\n---\n\n<Download file="/src/assets/gone.png" label="x" />\n',
      /broken\.mdx \(<Download> prop "file"\)/,
    ],
  ])("fails the build on a declared asset that names nothing: %s", (_, name, raw, message) => {
    const broken = join(rootDir, "src/content/pages", name);
    writeFileSync(broken, raw);

    expect(collect).toThrow(message);

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
          shape: { name: { type: "string" }, portrait: { type: "file" } },
        },
      },
    };

    expect(collect({ collections: authors }).files).toEqual(["/src/assets/brief.pdf"]);
  });

  it("bundles alwaysInclude patterns no content references", () => {
    const { images, files } = collect({ alwaysInclude: ["orphan.png"] });

    // Nothing explains what an always-included file is for, so it goes in both.
    expect(images).toContain("/src/assets/orphan.png");
    expect(files).toContain("/src/assets/orphan.png");
  });
});
