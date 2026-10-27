# Astronaut CMS

A Git-native headless CMS built as an Astro integration.
It provides a visual admin interface for managing structured content directly in your repository, with no external database and no proprietary backend, just Git.

## Features

### Zero-Config Setup

Add the integration to your Astro config and the admin panel appears at `/admin`.
Astronaut CMS auto-discovers your content collections, so there is nothing else to configure to get started.

### Your Zod Schemas Drive the UI

Editor forms are generated directly from the Zod schemas in your `content.config.ts`.
Your content types, validation, TypeScript types, and editor UI share a single source of truth.

### Built Into Astro

Astronaut CMS runs inside your Astro project rather than next to it.
It reads `content.config.ts` as is, including `glob()` and `file()` loaders, `reference()` and `image()` fields, and third-party schemas such as Starlight's.
Multilingual content follows your `i18n` config, and `base` and `trailingSlash` are honored throughout.
The admin and its API are injected as on-demand routes served by your SSR adapter, while the rest of the site stays prerendered.
In `astro dev`, it edits the working tree directly, so local editing needs no OAuth app.
Collections and MDX components get generated types, and secrets are declared through `astro:env`.
Media flows through `astro:assets` with ready-made `Image` and `Video` components.
Builds fail on content the admin could not save, and unreferenced library files are pruned from the output.

### Git-Native Storage

Every edit becomes a Git commit or pull/merge request.
You get version history, diffs, branching, and code review for content without any additional tooling.
No database to provision, no server to run, fully compatible with static builds.

### Atomic Batch Publishing

Stage changes across multiple collections and entries, then publish everything as a single commit or PR.
This prevents partial updates and keeps coordinated changes, like a new page with its assets and navigation, consistent.

### MDX Block Editor

Non-technical users compose pages from text blocks and custom components without writing raw MDX.
Each component is a form with Zod-validated props defined in `cms.config.ts`, and blocks can be reordered via drag-and-drop.

### Live Preview

A WYSIWYG editor renders text blocks and custom components as you type, so what you compose closely matches the final output.

### Media Library

Browse, upload, replace, rename, and delete assets with folder navigation.
An inline asset picker integrates directly into image and file fields.
Files live in the repository by default, or in any S3-compatible object store (AWS S3, Cloudflare R2, MinIO) when the library outgrows Git.
Uploads then go straight from the browser to the bucket through a presigned URL, and the site serves them from your CDN.

### Agent-Ready

The admin exposes its content operations to AI agents through two protocols at once.
A built-in assistant edits content from a chat panel inside the CMS, and [WebMCP](https://webmachinelearning.github.io/webmcp/) hands the same tools to an agent running in the editor's own browser.
Both go through the same server operations, so an agent reaches exactly what the interface reaches and every change still lands in the changeset for a human to review.

### GitHub and GitLab Backends

Ships with OAuth-based storage backends for both GitHub and GitLab, plus a local backend for development.
Adding new Git providers means implementing a single interface.

## Alternatives

Astronaut CMS is made for Astro sites that keep their content in Git.
It is an Astro integration rather than a separate app, so it builds on your existing content collections, routes, assets, and dev server.
Its editor is generated from the Zod schemas of your content collections, every change is published atomically as a commit or pull request, and pages are composed from MDX blocks without touching code.

Other content management systems with a different focus:

- [Apostrophe](https://apostrophecms.com/): database-backed CMS with in-context page editing and enterprise multisite support.
- [CloudCannon](https://cloudcannon.com/): commercial hosted platform with visual editing for many static site generators.
- [Dark Matter](https://getdarkmatter.dev): desktop app for editing local Astro content collections.
- [Decap CMS](https://decapcms.org/): long-established, framework-agnostic Git CMS configured through YAML.
- [EmDash](https://emdashcms.com): full-stack, database-backed Astro CMS in the spirit of WordPress with sandboxed plugins.
- [Keystatic](https://keystatic.com/): Git-based CMS with a TypeScript configuration API.
- [Pages CMS](https://pagescms.org/): hosted Git CMS for GitHub repositories that requires no installation.
- [Spinal](https://spinalcms.com/): commercial Git-based CMS tailored to content marketing teams.
- [StudioCMS](https://studiocms.dev/): Astro-native, database-backed CMS for server-rendered sites with a plugin ecosystem.
- [Sveltia CMS](https://github.com/sveltia/sveltia-cms): modern, faster drop-in replacement for Decap CMS.
- [TinaCMS](https://tina.io/): visual inline editing backed by Git with a GraphQL content API.
