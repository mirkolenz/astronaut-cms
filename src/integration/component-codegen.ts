import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "pathe";

/** The module a site imports its MDX components and their props from. */
export const COMPONENTS_MODULE = "astronaut-cms:components";

const quote = (value: string) => JSON.stringify(value);

// The default slot is only forwarded when filled, so a component asking
// `Astro.slots.has("default")` gets the answer the MDX body gave.
function wrapperModule(name: string, file: string): string {
  return `---
import Component from ${quote(file)};
import { resolveProps } from "./props.ts";

const props = resolveProps(${quote(name)}, Astro.props);
---

{Astro.slots.has("default") ? <Component {...props}><slot /></Component> : <Component {...props} />}
`;
}

/**
 * The modules behind {@link COMPONENTS_MODULE}, by file name: a wrapper per
 * component that applies its schema before rendering it, and the index that
 * exports them, each by name and all together as `mdxComponents`.
 */
export function componentModules(configPath: string | null, files: Record<string, string>): Record<string, string> {
  const names = Object.keys(files);
  const modules: Record<string, string> = {
    "index.ts": [
      ...names.map((name) => `import ${name} from "./${name}.astro";`),
      `export { ${names.join(", ")} };`,
      `export const mdxComponents = { ${names.join(", ")} };\n`,
    ].join("\n"),
  };

  if (!configPath || names.length === 0) return modules;

  modules["props.ts"] = `\
import { components } from ${quote(configPath)};
import { propsResolver } from "astronaut-cms/internal";

export const resolveProps = propsResolver(components);
`;

  for (const [name, file] of Object.entries(files)) {
    modules[`${name}.astro`] = wrapperModule(name, file);
  }

  return modules;
}

/**
 * Writes `modules` into `dir` and removes any other file there. A file whose
 * content is unchanged is left alone, so the dev server reloads nothing.
 */
export function writeModules(dir: string, modules: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });

  for (const file of readdirSync(dir)) {
    if (!Object.hasOwn(modules, file)) rmSync(join(dir, file));
  }

  for (const [file, content] of Object.entries(modules)) {
    const path = join(dir, file);

    if (!existsSync(path) || readFileSync(path, "utf-8") !== content) writeFileSync(path, content);
  }
}

/**
 * The declaration of {@link COMPONENTS_MODULE}, read off the type of the
 * config's `components` export, which `typesDir` holds a relative import of.
 */
export function componentTypes(typesDir: string, configPath: string | null, names: string[]): string {
  const config = configPath && relative(typesDir, configPath);
  const components = config ? `typeof import(${quote(config.startsWith(".") ? config : `./${config}`)}).components` : "{}";

  return `declare module "${COMPONENTS_MODULE}" {
  type Infer<Side extends "input" | "output"> = import("astronaut-cms/internal").InferComponentProps<${components}, Side>;
  type Input = Infer<"input">;
  // As astro declares any \`.astro\` module, taking the props MDX writes and any attribute besides.
  type Wrapper<Name extends keyof Input> = (props: Input[Name] & Record<string, unknown>) => any;

  /** The props each component renders with, every default of its schema applied. */
  export type ComponentProps = Infer<"output">;

  /** Every component by name, for \`<Content components={mdxComponents} />\`. */
  export const mdxComponents: { ${names.map((name) => `${name}: Wrapper<${quote(name)}>`).join("; ")} };
${names.map((name) => `  export const ${name}: Wrapper<${quote(name)}>;\n`).join("")}}
`;
}
