import { join } from "pathe";
import { expect, it } from "vitest";
import { file } from "@/internal/loader-stubs";
import { loadConfigs } from "@/integration/load-config";
import { project } from "./fixtures/project";

const warn = () => {};

it("rejects file collections the CMS cannot serialize safely", async () => {
  const custom = file("src/data.json", { parser: JSON.parse });

  for (const loader of [{ __cmsFileName: "src/data.csv" }, custom]) {
    const root = project({
      "src/content.config.ts": `export const collections = { records: { loader: ${JSON.stringify(loader)} } };`,
    });

    await expect(
      loadConfigs(
        root,
        {
          content: join(root, "src/content.config.ts"),
          cms: null,
        },
        warn,
      ),
    ).rejects.toThrow('Collection "records" uses file(');
  }
});

it("carries a collection's label and description into the manifest", async () => {
  const root = project({
    "src/content.config.ts": `export const collections = { jobs: { loader: { __cmsPattern: "**/*.md" } } };`,
    "src/cms.config.ts": `export const collections = { jobs: { label: "Jobs", description: "Open positions." } };`,
  });

  const { collections } = await loadConfigs(
    root,
    {
      content: join(root, "src/content.config.ts"),
      cms: join(root, "src/cms.config.ts"),
    },
    warn,
  );

  expect(collections.jobs).toMatchObject({
    sort: "id",
    label: "Jobs",
    description: "Open positions.",
  });
});

it("rejects a component that points editors to an unknown collection", async () => {
  const root = project({
    "src/content.config.ts": `export const collections = { jobs: { loader: { __cmsPattern: "**/*.md" } } };`,
    "src/cms.config.ts": `export const components = { Jobs: { props: null, collections: ["jobs", "projects"] } };`,
  });

  await expect(
    loadConfigs(
      root,
      {
        content: join(root, "src/content.config.ts"),
        cms: join(root, "src/cms.config.ts"),
      },
      warn,
    ),
  ).rejects.toThrow('Jobs lists "projects"');
});

it("resolves each component's file like the site's imports, and refuses a missing one", async () => {
  const config = (path: string) =>
    `export const components = { Steps: { props: null, component: "@/components/Steps.astro", children: { Step: { props: null, component: "${path}" } } } };`;
  const files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "src/components/Steps.astro": "",
    "src/components/Step.astro": "",
  };
  const root = project({ ...files, "src/cms.config.ts": config("./components/Step.astro") });

  const { componentFiles } = await loadConfigs(
    root,
    { content: null, cms: join(root, "src/cms.config.ts") },
    warn,
  );

  expect(componentFiles).toEqual({
    Steps: join(root, "src/components/Steps.astro"),
    Step: join(root, "src/components/Step.astro"),
  });

  const broken = project({ ...files, "src/cms.config.ts": config("@/components/Missing.astro") });

  await expect(
    loadConfigs(broken, { content: null, cms: join(broken, "src/cms.config.ts") }, warn),
  ).rejects.toThrow('Step renders with "@/components/Missing.astro", which names no file');
});
