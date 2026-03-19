import { defineCollection, reference } from "astro:content";
import { glob, file } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      draft: z.boolean().default(false),
      cover: image().optional(),
      author: reference("authors").optional(),
    }),
});

const authors = defineCollection({
  loader: file("src/data/authors.json"),
  schema: z.object({
    name: z.string(),
    email: z.email().optional(),
    bio: z.string().optional(),
  }),
});

const categories = defineCollection({
  loader: file("src/data/categories.toml"),
  schema: z.object({
    label: z.string(),
    color: z.string().default("#888888"),
  }),
});

export const collections = { blog, authors, categories };
