import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "pathe";
import { expect, it } from "vitest";
import { componentModules, componentTypes, writeModules } from "@/integration/component-codegen";
import { project } from "./fixtures/project";

const modules = componentModules("/site/src/cms.config.ts", {
  Hero: "/site/src/components/Hero.astro",
});

it("wraps each component to apply its schema and maps them all by name", () => {
  expect(Object.keys(modules).toSorted()).toEqual(["Hero.astro", "index.ts", "props.ts"]);
  expect(modules["Hero.astro"]).toContain(
    'import Component from "/site/src/components/Hero.astro";',
  );
  expect(modules["Hero.astro"]).toContain('await resolveProps("Hero", Astro.props)');
  expect(modules["Hero.astro"]).toContain(
    'Astro.slots.has("default") ? <Component {...props}><slot /></Component> : <Component {...props} />',
  );
  expect(modules["props.ts"]).toContain('import { components } from "/site/src/cms.config.ts";');
  expect(modules["index.ts"]).toContain("export const mdxComponents = { Hero };");
  expect(
    componentTypes("/site/.astro/integrations/astronaut-cms", "/site/src/cms.config.ts", ["Hero"]),
  ).toContain('typeof import("../../../src/cms.config.ts").components');
});

it("rewrites only changed files and removes stale ones", () => {
  const dir = join(project({ "out/Stale.astro": "" }), "out");

  writeModules(dir, modules);
  writeFileSync(join(dir, "index.ts"), "edited");
  utimesSync(join(dir, "props.ts"), 0, 0);
  writeModules(dir, modules);

  expect(statSync(join(dir, "props.ts")).mtimeMs).toBe(0);
  expect(readFileSync(join(dir, "index.ts"), "utf-8")).toBe(modules["index.ts"]);
  expect(() => statSync(join(dir, "Stale.astro"))).toThrow();
});
