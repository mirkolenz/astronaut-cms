import type { CollectionManifest } from "@shared/types";

// Stand-in for the build-time `virtual:astronaut-cms/collections` module. One
// collection with a required field is enough to exercise the write path.
const collections: CollectionManifest = {
  posts: {
    name: "posts",
    type: "content",
    loaderType: "glob",
    loaderPattern: "**/*.md",
    loaderBase: "src/content/blog",
    loaderFileName: null,
    schema: { type: "object", shape: { title: { type: "string" } } },
  },
};

export default collections;
