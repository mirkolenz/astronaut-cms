import { readdirSync, readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { esmExternalRequirePlugin, type Plugin } from "vite";

interface Package {
  dir: string;
  name: string;
  version?: string;
  license?: string;
}

const packages = new Map<string, Package | null>();

/**
 * The package a resolved file belongs to: the nearest `package.json` with a
 * name, since a nested one may only set the module type of its directory.
 */
function owningPackage(file: string): Package | undefined {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (!packages.has(dir)) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Omit<Package, "dir">;
        packages.set(dir, manifest.name ? { ...manifest, dir } : null);
      } catch {
        packages.set(dir, null);
      }
    }

    const found = packages.get(dir);

    if (found) return found;
  }

  return undefined;
}

interface DependencyPolicy {
  /** This package, whose own modules are always compiled in. */
  self: string;
  /** Packages left for the site to install and resolve. */
  external: Iterable<string>;
  /** Fails the build on any other package rather than compiling it in. */
  strict?: boolean;
}

/**
 * Decides per import whether a package is compiled in, from the package the
 * import resolves to rather than from how the specifier is spelled, so subpaths,
 * aliases and type packages are all judged by the package that owns them.
 * Specifiers with a scheme (`node:`, `virtual:`, `astro:`) are the host's.
 * The CommonJS packages compiled in then import the externals they require,
 * since an ES module has no `require`.
 */
export function dependencyPolicy({ self, external, strict = false }: DependencyPolicy) {
  const externals = new Set(external);

  const policy: Plugin = {
    name: "dependency-policy",
    resolveId: {
      // Ahead of the dts plugin, so declarations are judged by the same policy.
      order: "pre",
      // A path stays in the package of its importer, which was judged already.
      filter: { id: { exclude: /^[./\0]/ } },
      async handler(id, importer, options) {
        if (!importer) return null;

        if (URL.canParse(id)) return { id, external: true };

        const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });

        if (!resolved || resolved.external) return resolved;

        const owner = owningPackage(resolved.id)?.name;

        if (!owner || owner === self) return resolved;

        if (externals.has(owner)) return { id, external: true };

        if (strict) this.error(`${importer} imports "${id}" of ${owner}, which is not a dependency.`);

        return resolved;
      },
    },
  };

  const requires = esmExternalRequirePlugin({
    external: [...externals].map((name) => new RegExp(`^${RegExp.escape(name)}(/|$)`)),
  });

  return [policy, requires];
}

/**
 * Resolves each of `aliases` to its stand-in, matched exactly so a stand-in can
 * still import the subpaths of what it replaces. Scoped to one environment,
 * which `resolve.alias` cannot be.
 */
export function environmentAliases(environment: string, aliases: Record<string, string>): Plugin {
  const targets = new Map(Object.entries(aliases));

  return {
    name: "environment-aliases",
    applyToEnvironment: ({ name }) => name === environment,
    resolveId: {
      order: "pre",
      filter: { id: [...targets.keys()].map((id) => new RegExp(`^${RegExp.escape(id)}$`)) },
      handler: (id) => targets.get(id),
    },
  };
}

/** An entry of the license list Vite's `build.license` writes as JSON. */
interface LicenseEntry {
  name: string;
  version: string;
  identifier?: string;
  text?: string;
}

const VITE_LICENSES = ".vite/license.json";

const STYLESHEET_IMPORTS = /@(?:import|plugin)\s+["']([^"']+)["']/g;

/**
 * The packages a stylesheet pulls in through `@import` and `@plugin`, following
 * its relative imports. Tailwind inlines them itself, so they never reach the
 * module graph. Node resolves them, since a package of only CSS exports nothing
 * under the conditions of a script.
 */
function stylesheetPackages(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(STYLESHEET_IMPORTS)].flatMap(([, specifier = ""]) => {
    const manifest = findPackageJSON(specifier, pathToFileURL(file)) ?? [];

    if (!specifier.startsWith(".") || !specifier.endsWith(".css")) return manifest;

    return [manifest, stylesheetPackages(resolvePath(dirname(file), specifier))].flat();
  });
}

/**
 * Vite's `build.license`, completed with what it leaves out: the packages in
 * worker bundles, which are built on their own, those behind assets such as
 * fonts, and those a stylesheet inlines. Vite writes its list as JSON, and the
 * main build merges it with the rest and writes `fileName` in Markdown. Listed
 * in the environment's `rolldownOptions`, the plugin runs in its worker builds too.
 */
export function licenseExtras(self: string, fileName: string): { option: { fileName: string }; plugin: Plugin } {
  // Per environment, which its worker builds share by name, and emptied once written.
  const extras = new Map<string, Map<string, Package>>();

  const add = (environment: string, ids: Iterable<string>): void => {
    const packages = extras.get(environment) ?? new Map<string, Package>();

    for (const id of ids) {
      const found = owningPackage(id);

      if (found && found.name !== self) packages.set(found.dir, found);
    }

    extras.set(environment, packages);
  };

  const plugin: Plugin = {
    name: "license-extras",
    generateBundle: {
      // After Vite has written its list.
      order: "post",
      handler(_, bundle) {
        const outputs = Object.values(bundle);
        const { name: environment, config } = this.environment;

        // Each worker ends before the main build that imports it does.
        if (config.isWorker) {
          for (const output of outputs) if (output.type === "chunk") add(environment, output.moduleIds);

          return;
        }

        for (const output of outputs) {
          if (output.type !== "asset") continue;

          add(environment, output.originalFileNames);

          for (const name of output.originalFileNames) {
            if (name.endsWith(".css")) add(environment, stylesheetPackages(resolvePath(config.root, name)));
          }
        }

        const file = bundle[VITE_LICENSES];

        if (file?.type !== "asset") return this.error(`Vite wrote no ${VITE_LICENSES}.`);

        const entries = new Map<string, LicenseEntry>();

        for (const entry of JSON.parse(String(file.source)) as LicenseEntry[]) {
          entries.set(`${entry.name}@${entry.version}`, entry);
        }

        for (const { dir, name, version = "0.0.0", license } of extras.get(environment)?.values() ?? []) {
          const key = `${name}@${version}`;

          if (entries.has(key)) continue;

          const text = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)/i.test(entry));

          entries.set(key, {
            name,
            version,
            identifier: license?.trim(),
            text: text && readFileSync(join(dir, text), "utf8").trim(),
          });
        }

        const sections = [...entries]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, { name, version, identifier, text }]) =>
            [`## ${name} - ${version}${identifier ? ` (${identifier})` : ""}`, text].filter(Boolean).join("\n\n"),
          );

        delete bundle[VITE_LICENSES];
        this.emitFile({ type: "asset", fileName, source: `# Licenses\n\n${sections.join("\n\n")}\n` });
        extras.delete(environment);
      },
    },
  };

  return { option: { fileName: VITE_LICENSES }, plugin };
}
