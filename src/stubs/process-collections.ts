import { z } from "astro/zod";

interface RawCollection {
  schema?: unknown;
  type?: string;
  loader?: {
    __cmsPattern?: string | string[] | null;
    __cmsBase?: string | null;
    __cmsFileName?: string | null;
  };
}

export function processCollections(rawCollections: Record<string, RawCollection>) {
  const result: Record<string, unknown> = {};
  for (const [name, col] of Object.entries(rawCollections)) {
    let schema = col.schema;
    if (typeof schema === "function") {
      schema = schema({
        image: () => z.string().meta({ "x-cms-image": true }),
        file: () => z.string().meta({ "x-cms-file": true }),
        reference: (collection: string) => z.string().meta({ "x-cms-reference": collection }),
      });
    }
    result[name] = {
      name,
      type: col.type ?? "content",
      schema,
      loaderPattern: col.loader?.__cmsPattern ?? null,
      loaderBase: col.loader?.__cmsBase ?? null,
      loaderFileName: col.loader?.__cmsFileName ?? null,
      loaderType: col.loader?.__cmsFileName != null ? "file" : "glob",
    };
  }
  return result;
}
