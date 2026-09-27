import { describe, expect, it } from "vitest";
import { indexEntry } from "@/server/references";
import {
  classifyUsage,
  referencesFor,
  staleReferences,
  type AssetReference,
  type ReferenceIndex,
} from "@/shared/references";
import { client as config } from "virtual:astronaut-cms/server";
import type { CollectionManifestEntry } from "@/shared/types";

// What may be deleted is decided by two different kinds of evidence: a schema
// field or a markdown image that declares a value to be an asset, and a body
// that merely mentions a path.
// The build only trusts the first, because it decides what to bundle; deletion
// has to trust both, or an image used in markdown prose looks unused.

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
  const result = new Map<string, AssetReference[]>();

  indexEntry(result, posts, {
    id: "hello",
    format: "md",
    data: { cover: "/src/assets/cover.png" },
    body: "Prose with ![alt](../../assets/inline.png) and a note on ../../assets/brief.pdf.",
  });

  return [...result];
}

describe("asset references", () => {
  it("collects a schema field, a markdown image and a path only the body mentions", () => {
    const references = index();

    expect(referencesFor(references, "cover.png")[0]).toMatchObject({
      collection: "posts",
      entryId: "hello",
      declared: true,
    });
    expect(referencesFor(references, "inline.png")).toEqual([
      expect.objectContaining({ where: "markdown image", declared: true }),
    ]);
    expect(referencesFor(references, "brief.pdf")[0]).toMatchObject({
      where: "body",
      declared: false,
    });
  });

  it("treats only unreferenced files as orphans", () => {
    const usage = classifyUsage(
      ["cover.png", "inline.png", "brief.pdf", "stray.png"],
      index(),
      config,
    );

    expect([...usage]).toEqual([
      ["cover.png", "used"],
      ["inline.png", "used"],
      ["brief.pdf", "used"],
      ["stray.png", "orphan"],
    ]);
  });

  // The two reports weigh the same evidence differently: prose is enough to keep
  // a file, never enough to call an entry broken.
  it("reports a declared reference to a missing file, but not a textual one", () => {
    expect(staleReferences(index(), [])).toEqual([
      expect.objectContaining({ path: "cover.png", entryId: "hello", declared: true }),
      expect.objectContaining({ path: "inline.png", where: "markdown image" }),
    ]);
    expect(staleReferences(index(), ["cover.png", "inline.png"])).toEqual([]);
  });
});
