# Astronaut CMS

A Git-native headless CMS built as an Astro integration.
It provides a visual admin interface for managing structured content directly in your repository — no external database, no proprietary backend, just Git.

## Features

### Zero-Config Setup

Add the integration to your Astro config and the admin panel appears at `/admin`.
Astronaut CMS auto-discovers your content collections — there is nothing else to configure to get started.

### Your Zod Schemas Drive the UI

Editor forms are generated directly from the Zod schemas in your `content.config.ts`.
No other CMS does this — every alternative requires you to redefine your content model in a separate DSL, YAML file, or database.
With Astronaut CMS, your content types, validation, TypeScript types, and editor UI are a single source of truth.

### Git-Native Storage

Every edit becomes a Git commit or pull/merge request.
You get version history, diffs, branching, and code review for content without any additional tooling.
No database to provision, no server to run, fully compatible with static builds.

### Atomic Batch Publishing

Stage changes across multiple collections and entries, then publish everything as a single commit or PR.
This prevents partial updates and keeps coordinated changes — like a new page with its assets and navigation — consistent.

### MDX Block Editor

Non-technical users compose pages from text blocks and custom components without writing raw MDX.
Each component is a form with Zod-validated props defined in `cms.config.ts`, and blocks can be reordered via drag-and-drop.

### Live Preview

A WYSIWYG editor renders text blocks and custom components as you type, so what you compose closely matches the final output.

### Media Library

Browse, upload, replace, rename, and delete assets with folder navigation.
An inline asset picker integrates directly into image and file fields.

### GitHub and GitLab Backends

Ships with OAuth-based storage backends for both GitHub and GitLab, plus a local backend for development.
Adding new Git providers means implementing a single interface.

## Comparison

| CMS                                                   | Open Source | Astro Integration | Content Storage | Uses Astro Schemas | Schema Definition | MDX Block Editor | Batch Publishing | Live Preview | Media Library | Static Builds |
| ----------------------------------------------------- | ----------- | ----------------- | --------------- | ------------------ | ----------------- | ---------------- | ---------------- | ------------ | ------------- | ------------- |
| Astronaut CMS                                         | Yes         | Native            | Git             | Yes                | Zod               | Yes              | Yes              | Yes          | Yes           | Yes           |
| [Apostrophe](https://apostrophecms.com/)              | Yes         | Plugin (SSR)      | Database        | No                 | Own DSL           | No               | N/A              | Yes          | Yes           | No            |
| [CloudCannon](https://cloudcannon.com/)               | No          | Plugin            | Git             | No                 | GUI               | No               | No               | Yes          | Yes           | Yes           |
| [Dark Matter](https://getdarkmatter.dev)              | No          | Desktop App       | Git             | Yes                | Zod               | No               | No               | Yes          | No            | Yes           |
| [Decap CMS](https://decapcms.org/)                    | Yes         | Manual            | Git             | No                 | YAML              | No               | No               | Yes          | Yes           | Yes           |
| [Keystatic](https://keystatic.com/)                   | Yes         | Plugin            | Git             | No                 | Own DSL           | No               | No               | No           | Yes           | Yes           |
| [Pages CMS](https://pagescms.org/)                    | Yes         | Manual            | Git             | No                 | YAML              | No               | No               | No           | Yes           | Yes           |
| [Spinal](https://spinalcms.com/)                      | No          | Plugin            | Git             | No                 | GUI               | No               | No               | No           | No            | Yes           |
| [StudioCMS](https://studiocms.dev/)                   | Yes         | Native            | Database        | No                 | DB Migrations     | No               | N/A              | No           | Via Plugin    | No            |
| [Sveltia CMS](https://github.com/sveltia/sveltia-cms) | Yes         | Manual            | Git             | No                 | YAML              | No               | No               | No           | Yes           | Yes           |
| [TinaCMS](https://tina.io/)                           | Yes         | Plugin            | Git + API       | No                 | Own DSL           | Yes              | No               | Yes          | Yes           | Yes           |
