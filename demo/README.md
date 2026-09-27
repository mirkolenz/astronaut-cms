# Meridian — Astronaut CMS Demo

A small, self-contained website that showcases [Astronaut CMS](../README.md) with a clean, intuitive editing experience.
It is a fictional design studio site with a landing page, a journal, and a team, all editable through a schema-driven admin panel.

## Run it

```sh
npm install
npm run dev --workspace demo
```

The demo runs the package as published, built into `dist/` first.
Run `npm run dev` in the repository root beside it to rebuild the package on every change.

Then open two tabs:

- **http://localhost:4321/** — the public site
- **http://localhost:4321/admin** — the CMS admin panel

Edits made in the admin panel are written straight to the files in `src/`, so the site updates live.

## What it demonstrates

- **Schema-driven forms.** The editor UI is generated from the Zod schemas in [`src/content.config.ts`](src/content.config.ts). Text inputs, a date picker, a category dropdown, a featured toggle, and a media picker for images all appear automatically.
- **Three collection shapes.** Markdown/MDX pages (`pages`), blog posts (`posts`, stored in `src/content/blog`), and a JSON file collection (`team`), with posts referencing team members by id.
- **Visual block editor.** Pages are composed from a small set of custom MDX components defined in [`src/cms.config.ts`](src/cms.config.ts) — a hero, a feature grid, a call to action, a quote, and a figure — arranged with drag-and-drop instead of raw MDX.
- **Render-time assets.** `image()` fields are stored as plain paths and resolved to optimized assets by `astronaut-cms/Image.astro`.

## Layout

```
demo/
├── astro.config.ts          # mdx + react + astronaut-cms integration
├── src/
│   ├── content.config.ts     # collections → drives the admin forms
│   ├── cms.config.ts         # block components → drives the block editor
│   ├── components/           # .astro renderers for each block
│   ├── content/              # pages/ and blog/ entries (edited via the CMS)
│   ├── data/team.json        # the team file collection
│   ├── assets/               # images referenced by content
│   ├── layouts/ + pages/     # the public site
│   └── styles/global.css     # the editorial design system
└── public/favicon.svg
```
