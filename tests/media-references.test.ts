import { describe, expect, it } from "vitest";
import { indexEntry } from "@/server/references";
import {
  referencedPaths,
  referencesFor,
  staleReferences,
  type IndexedFile,
  type ReferenceIndex,
} from "@/shared/references";
import type { CollectionManifestEntry } from "@/shared/types";

// What may be deleted is decided by two different kinds of evidence: a schema
// field or a markdown image that declares a value to be an asset, and a body
// that merely mentions a path.
// Deletion has to trust both, or an image used in markdown prose looks unused.

const posts: CollectionManifestEntry = {
  name: "posts",
  type: "content",
  loaderType: "glob",
  loaderPattern: "**/*.md",
  loaderBase: "src/content/blog",
  loaderFileName: null,
  sort: "id",
  schema: { type: "object", shape: { cover: { type: "image" } } },
};

function index(): ReferenceIndex {
  const result = new Map<string, IndexedFile>();

  indexEntry(result, posts, {
    id: "hello",
    path: "src/content/blog/hello.md",
    format: "md",
    data: { cover: "/src/assets/cover.png" },
    body: "Prose with ![alt](../../assets/inline.png) and a note on ../../assets/brief.pdf.",
  });

  return [...result.values()];
}

describe("asset references", () => {
  it("collects a schema field, a markdown image and a path only the body mentions", () => {
    const references = index();

    expect(referencesFor(references, { library: "repo", path: "cover.png" })[0]).toMatchObject({
      collection: "posts",
      entryId: "hello",
      declared: true,
    });
    expect(referencesFor(references, { library: "repo", path: "inline.png" })).toEqual([
      expect.objectContaining({ where: "markdown image", declared: true }),
    ]);
    expect(referencesFor(references, { library: "repo", path: "brief.pdf" })[0]).toMatchObject({
      where: "body",
      declared: false,
    });
  });

  it("counts every kind of reference as use", () => {
    expect(referencedPaths(index(), "repo")).toEqual(new Set(["cover.png", "inline.png", "brief.pdf"]));
  });

  // The two reports weigh the same evidence differently: prose is enough to keep
  // a file, never enough to call an entry broken.
  it("reports a declared reference to a missing file, but not a textual one", () => {
    expect(staleReferences(index(), "repo", [])).toEqual([
      expect.objectContaining({ path: "cover.png", entryId: "hello", declared: true }),
      expect.objectContaining({ path: "inline.png", where: "markdown image" }),
    ]);
    expect(staleReferences(index(), "repo", ["cover.png", "inline.png"])).toEqual([]);
    expect(staleReferences(index(), "s3", [])).toEqual([]);
  });
});
