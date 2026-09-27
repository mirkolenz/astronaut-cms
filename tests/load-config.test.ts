import { join } from "pathe";
import { expect, it } from "vitest";
import { file } from "@/internal/loader-stubs";
import { loadConfigs } from "@/integration/load-config";
import { project } from "./fixtures/project";

it("rejects file collections the CMS cannot serialize safely", async () => {
  const custom = file("src/data.json", { parser: JSON.parse });

  expect(custom.__cmsCustomParser).toBe(true);

  for (const loader of [
    { __cmsFileName: "src/data.csv" },
    custom,
  ]) {
    const root = project({
      "src/content.config.ts": `export const collections = { records: { loader: ${JSON.stringify(loader)} } };`,
    });

    await expect(loadConfigs(root, {
      content: join(root, "src/content.config.ts"),
      cms: null,
    })).rejects.toThrow('Collection "records" uses file(');
  }
});
