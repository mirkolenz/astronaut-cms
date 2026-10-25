import { defineCollection, reference } from "astro:content";
import { glob, file } from "astro/loaders";
import { z } from "astro/zod";

// Landing and standalone pages, each composed from the MDX block components in
// `cms.config.ts`. The schema stays tiny on purpose: title and description are
// all the editor needs to fill in, everything else is arranged visually.
const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

// Blog posts. Every field maps to an intuitive control in the admin panel: text
// inputs, a date picker, a media picker for the cover, a dropdown for category,
// a toggle for featured, and a reference dropdown that lists the team members.
// The collection key ("posts") is independent of its directory ("blog"). The
// admin resolves storage from the loader's `base`.
const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      excerpt: z.string(),
      publishDate: z.coerce.date(),
      author: reference("team"),
      cover: image(),
      category: z.enum(["Design", "Engineering", "Studio Notes"]),
      featured: z.boolean().default(false),
    }),
});

// Team members, stored as a single JSON file (a file collection). The CMS lets
// you add, reorder (it is sorted by file order in cms.config), and edit
// entries in place, and other collections reference them by id.
const team = defineCollection({
  loader: file("src/data/team.json"),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      avatar: image(),
      bio: z.string(),
    }),
});

// The studio's contact details, a singleton: its glob names one file, so the
// admin opens that entry directly and offers no way to add another.
const studio = defineCollection({
  loader: glob({ pattern: "studio.yml", base: "src/content" }),
  schema: z.object({
    name: z.string(),
    email: z.string().email(),
    address: z.string(),
  }),
});

export const collections = { pages, posts, team, studio };
