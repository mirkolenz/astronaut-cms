import { expect, it } from "vitest";
import { contentEntries } from "@/integration/content-files";
import { project } from "@tests/fixtures/project";

it("reads a file collection whose literal filename contains glob characters", () => {
  const root = project({ "src/data/team[2026].json": '[{"id":"alice","name":"Alice"}]' });
  const entries = contentEntries(
    root,
    {
      team: {
        name: "team",
        type: "data",
        schema: null,
        loaderType: "file",
        loaderPattern: null,
        loaderBase: null,
        loaderFileName: "src/data/team[2026].json",
        sort: "id",
        singleton: null,
      },
    },
    {},
  );

  expect(entries).toMatchObject([
    { file: "src/data/team[2026].json", scope: 'entry "alice"', data: { name: "Alice" } },
  ]);
});
