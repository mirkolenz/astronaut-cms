import { join } from "pathe";
import { build } from "vite";
import { expect, it } from "vitest";
import { mediaGraph, type MediaGraph } from "@/integration/media-graph";
import { repoMedia } from "./fixtures/media";
import { project } from "./fixtures/project";

const graphFor = (root: string, ignore: string[] = []): MediaGraph =>
  mediaGraph({
    rootDir: root,
    srcDir: `${join(root, "src")}/`,
    media: repoMedia(),
    ignore,
  });

it("keeps the library when on-demand code reaches media", async () => {
  const root = project({
    "src/assets/logo.svg": "<svg/>",
    "src/assets/admin.png": "admin",
    "src/pages/contact.ts": `import logo from "../assets/logo.svg";\nexport default logo;`,
    "src/admin.ts": `import admin from "./assets/admin.png";\nexport default admin;`,
    "src/entry.ts": `export { default } from "./pages/contact.ts";\nexport { default as admin } from "./admin.ts";`,
  });
  const graph = graphFor(root, ["/admin"]);

  graph.setRoutes([
    {
      entrypoint: "src/pages/contact.ts",
      isPrerendered: false,
      origin: "project",
      pattern: "/contact",
    },
    { entrypoint: "src/admin.ts", isPrerendered: false, origin: "external", pattern: "/admin" },
  ]);

  await build({
    root,
    logLevel: "silent",
    plugins: graph.plugins,
    build: { ssr: "src/entry.ts", write: false, assetsInlineLimit: 0 },
  });

  expect(graph.onDemand).toEqual(["/contact"]);
  expect(graph.prune(join(root, "dist"), false)).toBeNull();
  graph.setRoutes([]);
  expect(graph.prune(join(root, "dist"), false)).toBeNull();
  expect(graph.prune(join(root, "dist"), true)).toEqual(new Map());
});

it("prunes by default when on-demand routes cannot reach media or content", async () => {
  const root = project({
    "src/assets/logo.svg": "<svg/>",
    "src/pages/home.ts": `import logo from "../assets/logo.svg";\nexport default logo;`,
    "src/pages/contact.ts": `export default "contact";`,
    "server.ts": `export { default as home } from "./src/pages/home.ts";\nexport { default as contact } from "./src/pages/contact.ts";`,
  });
  const graph = graphFor(root);

  graph.setRoutes([
    { entrypoint: "src/pages/home.ts", isPrerendered: true, origin: "project", pattern: "/" },
    {
      entrypoint: "src/pages/contact.ts",
      isPrerendered: false,
      origin: "project",
      pattern: "/contact",
    },
  ]);

  await build({
    root,
    logLevel: "silent",
    plugins: graph.plugins,
    build: { ssr: "server.ts", write: false },
  });

  expect(graph.onDemand).toEqual(["/contact"]);
  expect(graph.prune(join(root, "dist"), false)).toEqual(new Map());
});

it("keeps the library when an on-demand route reads content", async () => {
  const root = project({
    "src/pages/blog.ts": `import { getCollection } from "astro:content";\nexport default getCollection;`,
    "server.ts": `export { default } from "./src/pages/blog.ts";`,
  });
  const graph = graphFor(root);

  graph.setRoutes([
    { entrypoint: "src/pages/blog.ts", isPrerendered: false, origin: "project", pattern: "/blog" },
  ]);

  await build({
    root,
    logLevel: "silent",
    plugins: [
      ...graph.plugins,
      {
        name: "content-fixture",
        resolveId: (id) => (id === "astro:content" ? "\0astro:content" : null),
        load: (id) => (id === "\0astro:content" ? "export const getCollection = () => [];" : null),
      },
    ],
    build: { ssr: "server.ts", write: false },
  });

  expect(graph.prune(join(root, "dist"), false)).toBeNull();
});
