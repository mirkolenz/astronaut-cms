import { pathToFileURL } from "node:url";
import type { AstroConfig, AstroIntegrationLogger } from "astro";
import { glob, type DataStore, type LoaderContext } from "astro/loaders";
import { describe, expect, it } from "vitest";
import { contentEntries } from "@/integration/content-files";
import { parseContent } from "@/shared/content-parser";
import { glob as globStub } from "@/internal/loader-stubs";
import { ContentValidationError } from "@/shared/diagnostics";
import { globEntryId, globMatcher, globRoots, type CollectionManifestEntry } from "@/shared/types";
import { project } from "@tests/fixtures/project";
import { TreeStorage, storageOptions } from "@tests/fixtures/storage";

const posts = (
  loaderPattern: string | string[],
  loaderBase = "src/content/posts",
): CollectionManifestEntry => ({
  name: "posts",
  type: "content",
  schema: null,
  loaderType: "glob",
  loaderPattern,
  loaderBase,
  loaderFileName: null,
  sort: "id",
  singleton: null,
});

// What astro's glob() loader loads and skips for each pattern, checked against its tinyglobby walk.
const cases: [pattern: string | string[], base: string, loaded: string[], skipped: string[]][] = [
  [
    "**/*.mdx",
    "src/content/posts",
    ["a.mdx", "nested/b.mdx", "_draft.mdx"],
    ["a.md", ".hidden.mdx", ".dir/c.mdx", "../other/d.mdx"],
  ],
  ["firma.yml", "src/content", ["firma.yml"], ["posts/firma.yml", "firma.yaml"]],
  ["{a,b}/*.md", "src/content/posts", ["a/x.md", "b/y.md"], ["c/z.md", "a/n/x.md", "x.md"]],
  [["**/*.md", "!drafts/**"], "src/content/posts", ["post.md", "en/post.md"], ["drafts/post.md"]],
  ["**/*", "src/content", ["posts/a.md"], ["config.ts", "config.mjs"]],
];

/** The ids astro's own `glob()` loader gives the markdown files below `src/content/posts` of `root`. */
async function astroIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  const context: Partial<LoaderContext> & { entryTypes: Map<string, unknown> } = {
    collection: "posts",
    config: {
      root: pathToFileURL(`${root}/`),
      srcDir: pathToFileURL(`${root}/src/`),
    } as AstroConfig,
    logger: {
      warn: () => {},
      error: () => {},
    } as Partial<AstroIntegrationLogger> as AstroIntegrationLogger,
    store: {
      keys: () => [],
      get: () => undefined,
      set: ({ id }) => ids.push(id) > 0,
    } as Partial<DataStore> as DataStore,
    parseData: ({ data }) => Promise.resolve(data),
    generateDigest: () => "",
    entryTypes: new Map([
      [
        ".md",
        { getEntryInfo: ({ contents }: { contents: string }) => parseContent(contents, "md") },
      ],
    ]),
  };

  await glob({ pattern: "**/*.md", base: "src/content/posts" }).load(context as LoaderContext);

  return ids.toSorted();
}

describe("glob collections", () => {
  it.each(cases)("match %j as astro does", (pattern, base, loaded, skipped) => {
    const loads = globMatcher(posts(pattern, base));

    expect(loaded.filter((path) => !loads(`${base}/${path}`))).toEqual([]);
    expect(skipped.filter((path) => loads(`${base}/${path}`))).toEqual([]);
  });

  it("read from the project root without a base, and flag their own ids", () => {
    expect(globStub({ pattern: "**/*.md" })).toEqual({ __cmsPattern: "**/*.md", __cmsBase: "." });
    expect(globStub({ pattern: "**/*.md", generateId: ({ entry }) => entry })).toMatchObject({
      __cmsCustomId: true,
    });
  });

  it("walk only the static prefix of each pattern", () => {
    expect(
      globRoots(posts(["docs/**/*.md", "docs/api/*.md", "firma.yml", "!docs/drafts/**"], "")),
    ).toEqual([
      { path: "docs", file: false },
      { path: "firma.yml", file: true },
    ]);
    expect(globRoots(posts("**/*.md"))).toEqual([{ path: "src/content/posts", file: false }]);
  });

  it("name their entries as astro does", async () => {
    const files = {
      "src/content/posts/Über Uns.md": "",
      "src/content/posts/Hello World!.md": "",
      "src/content/posts/_draft.md": "",
      "src/content/posts/index.md": "",
      "src/content/posts/guide/index.md": "",
      "src/content/posts/Nested Dir/Some File.md": "",
      "src/content/posts/slugged.md": "---\nslug: custom/Path\n---\n",
    };
    const root = project(files);
    const col = posts("**/*.md");
    const ours = contentEntries(root, { posts: col }, {}).map(({ file, data }) =>
      globEntryId(col, file, data),
    );

    expect(ours.toSorted()).toEqual(await astroIds(root));
  });

  it("list and check only the files their loader loads", async () => {
    const col = posts(["**/*.md", "!drafts/**"]);
    const files = [
      "src/content/posts/a.md",
      "src/content/posts/drafts/b.md",
      "src/content/posts/c.mdx",
      "src/content/posts/.d.md",
      "src/content/other/e.md",
    ];
    const root = project(Object.fromEntries(files.map((file) => [file, ""])));
    const store = new TreeStorage(storageOptions({ posts: col }));

    store.tree = files;

    expect(await store.listEntries("posts")).toEqual([
      { id: "a", collection: "posts", format: "md", path: "src/content/posts/a.md" },
    ]);
    expect(contentEntries(root, { posts: col }, {}).map((entry) => entry.file)).toEqual([
      "src/content/posts/a.md",
    ]);
  });

  it("refuse writing an entry their loader would never load", async () => {
    const store = new TreeStorage(storageOptions({ posts: posts(["**/*.md", "!drafts/**"]) }));
    const entry = { data: {}, body: "", format: "md" as const };

    await store.saveEntry("posts", "_draft", entry);
    expect(store.written).toEqual(["src/content/posts/_draft.md"]);

    await expect(store.saveEntry("posts", "drafts/b", entry)).rejects.toThrow(
      ContentValidationError,
    );
    await expect(store.saveEntry("posts", "c", { ...entry, format: "mdx" })).rejects.toThrow(
      /loads only files matching "\*\*\/\*\.md, !drafts\/\*\*"/,
    );
    await expect(store.saveEntry("posts", "Über Uns", entry)).rejects.toThrow(
      /Use "über-uns" as the id/,
    );
    await expect(store.saveEntry("posts", "x", { ...entry, data: { slug: "y" } })).rejects.toThrow(
      /"slug" field/,
    );
  });

  it("keep an existing entry in the file astro names it by", async () => {
    const store = new TreeStorage(storageOptions({ posts: posts("**/*.md") }));
    const entry = { data: {}, body: "", format: "md" as const };

    store.tree = ["src/content/posts/Über Uns.md"];

    await store.saveEntry("posts", "über-uns", entry);
    await expect(
      store.saveEntry("posts", "über-uns", { ...entry, createOnly: true }),
    ).rejects.toThrow();
    expect(store.written).toEqual(["src/content/posts/Über Uns.md"]);
  });
});
