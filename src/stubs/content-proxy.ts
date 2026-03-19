import { z } from "astro/zod";

export function defineCollection(config: unknown) {
  return config;
}

export function reference(collection: string) {
  return z.string().meta({ "x-cms-reference": collection });
}
