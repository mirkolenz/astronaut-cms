import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
export function dependencyPolicy({
  self,
  external,
  strict = false,
}: DependencyPolicy): [Plugin, ReturnType<typeof esmExternalRequirePlugin>] {
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
