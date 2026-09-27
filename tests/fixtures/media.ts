import type { ClientLibrary, ClientMediaConfig } from "@/shared/media";

const library = (extensions: string[] | null = null): ClientLibrary => ({
  label: null,
  extensions,
  minFileSize: null,
  maxFileSize: null,
  imageOptimization: null,
});

/** A site with only the repository library. */
export const repoMedia = (extensions?: string[]): ClientMediaConfig => ({
  repo: { ...library(extensions), directory: "src/assets", alwaysInclude: [] },
  s3: null,
});

/** A site with an object store beside it, `directory` standing in for it in a dev run. */
export const s3Media = (directory?: string): ClientMediaConfig => ({
  ...repoMedia(),
  s3: {
    ...library(),
    publicUrl: "https://cdn.example.com",
    storeOrigin: "https://s3.example.com",
    ...(directory && { directory }),
  },
});
