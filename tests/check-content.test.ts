import { expect, it } from "vitest";
import { checkContent } from "@/integration/check-content";
import type { ContentEntry } from "@/integration/content-files";
import { repoMedia } from "./fixtures/media";
import { project } from "./fixtures/project";

it("rejects asset references that the generated loader cannot resolve", () => {
  const root = project({
    "src/assets/photo.pdf": "document",
    "src/assets/logo.svg": "<svg/>",
    "src/assets/.secret.txt": "hidden",
    "src/outside.png": "outside",
  });
  const entry: ContentEntry = {
    collection: {
      name: "pages",
      type: "content",
      schema: null,
      loaderType: "glob",
      loaderPattern: null,
      loaderBase: null,
      loaderFileName: null,
      sort: "id",
    },
    file: "src/content/pages/home.mdx",
    scope: "frontmatter",
    data: {},
    body: {
      diagnostics: [],
      images: [],
      leaves: [
        { kind: "image", value: "/src/assets/photo.pdf", path: "Figure.src" },
        { kind: "file", value: "/src/assets", path: "Download.src" },
        { kind: "image", value: "/src/assets/logo.svg", path: "Logo.src" },
        { kind: "file", value: "/src/assets/.secret.txt", path: "Secret.src" },
        { kind: "image", value: "/src/assets/../outside.png", path: "Outside.src" },
      ],
    },
  };

  const problems = checkContent([entry], root, repoMedia());

  expect(problems).toHaveLength(4);
  expect(problems[0]).toContain("Figure.src");
  expect(problems[1]).toContain("Download.src");
  expect(problems[2]).toContain("Secret.src");
  expect(problems[3]).toContain("Outside.src");
});
