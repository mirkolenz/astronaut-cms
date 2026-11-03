import type { CmsClientConfig, CmsServerConfig } from "@/integration/types";
import { repoMedia } from "@tests/fixtures/media";

// Stand-in for the build-time `virtual:astronaut-cms/server` module. Local
// storage, so no provider credential is involved in a test run, and one
// collection with a required field, enough to exercise the write path.
export const client: CmsClientConfig = {
  mountPoint: "/admin",
  storageType: "local",
  media: repoMedia([".png", ".jpg", ".svg", ".pdf"]),
  locale: "en",
  contentI18n: { locales: ["en", "de"], defaultLocale: "en" },
  capabilities: { publish: false, update: false },
  collections: {
    posts: {
      name: "posts",
      type: "content",
      loaderType: "glob",
      loaderPattern: "**/*.md",
      loaderBase: "src/content/blog",
      loaderFileName: null,
      sort: "id",
      singleton: null,
      schema: { type: "object", shape: { title: { type: "string" } } },
    },
  },
};

export const server: CmsServerConfig = {
  trailingSlash: "ignore",
  storage: { type: "local", rootDir: process.cwd() },
  media: null,
  ai: null,
};

export { components } from "@tests/fixtures/user-config";
