import { describe, expect, it } from "vitest";
import {
  classifyUsage,
  indexEntry,
  staleReferences,
  type ReferenceIndex,
} from "@client/lib/media/references";
import type { CollectionManifestEntry } from "@shared/types";

// What may be deleted is decided by two different kinds of evidence: a schema
// that declares a value to be an asset, and a body that merely mentions a path.
// The build only trusts the first, because it decides what to bundle; deletion
// has to trust both, or an image used in markdown prose looks unused.

const posts: CollectionManifestEntry = {
  name: "posts",
  type: "content",
  loaderType: "glob",
  loaderPattern: "**/*.md",
  loaderBase: "src/content/blog",
  loaderFileName: null,
  schema: { type: "object", shape: { cover: { type: "image" } } },
};

function index(): ReferenceIndex {
  const result: ReferenceIndex = new Map();

  indexEntry(result, posts, {
    id: "hello",
    format: "md",
    data: { cover: "/src/assets/cover.png" },
    body: "Prose with ![alt](../../assets/inline.png) and no other asset.",
  });

  return result;
}

describe("asset references", () => {
  it("collects a schema-declared field and a path only the body mentions", () => {
    const references = index();

    expect(references.get("cover.png")?.[0]).toMatchObject({
      collection: "posts",
      entryId: "hello",
      declared: true,
    });
    expect(references.get("inline.png")?.[0]).toMatchObject({ where: "body", declared: false });
  });

  it("treats only unreferenced files as orphans", () => {
    const usage = classifyUsage(["cover.png", "inline.png", "stray.png"], index());

    expect([...usage]).toEqual([
      ["cover.png", "used"],
      ["inline.png", "used"],
      ["stray.png", "orphan"],
    ]);
  });

  // The two reports weigh the same evidence differently: prose is enough to keep
  // a file, never enough to call an entry broken.
  it("reports a declared reference to a missing file, but not a textual one", () => {
    expect(staleReferences(index(), [])).toEqual([
      expect.objectContaining({ path: "cover.png", entryId: "hello", declared: true }),
    ]);
    expect(staleReferences(index(), ["cover.png"])).toEqual([]);
  });
});
