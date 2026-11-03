import { existsSync, readFileSync } from "node:fs";
import { join } from "pathe";
import type { Plugin } from "vite";
import type { CmsClientConfig, CmsServerConfig } from "@/integration/types";
import type { CollectionSort } from "@/shared/types";
import type { ComponentManifest } from "@/internal/user-config";
import { getFileExtension, parseMultiEntryFile } from "@/shared/content-parser";
import { ASTRO_IMAGE_FORMATS } from "@/shared/image-formats";
import { libraryDirectories, type ClientMediaConfig, type MediaRefConfig } from "@/shared/media";
import { DEV_API_ENVIRONMENT } from "@/integration/dev-api";
import { COMPONENTS_MODULE } from "@/integration/component-codegen";

export interface CmsVitePluginOptions {
  clientConfig: CmsClientConfig;
  /** Everything only the injected route may see: credentials’ identity, bucket, gateway. */
  serverConfig: CmsServerConfig;
  userConfigPath: string | null;
  /** The components as lowered in Node, whose schemas the server validates against. */
  components: ComponentManifest;
  /** The generated module behind `astronaut-cms:components`. */
  componentsEntry: string;
  rootDir: string;
}

/** What a module generated per load is told: whether it runs in the dev API, and how to watch a file. */
interface LoadContext {
  devApi: boolean;
  watch: (path: string) => void;
}

/**
 * Stands the Node stubs in for `astronaut-cms/editor` wherever a module runs on
 * the server: the integration loading `cms.config`, and the component wrappers
 * importing it as the site renders. The admin's editor primitives would touch
 * the DOM as they load there.
 */
export function editorStubPlugin(): Plugin {
  return {
    name: "astronaut-cms:editor-stub",
    enforce: "pre",

    resolveId(id, importer) {
      if (id !== "astronaut-cms/editor" || this.environment.config.consumer !== "server") return;

      return this.resolve("astronaut-cms/internal", importer, { skipSelf: true });
    },
  };
}

export function cmsVitePlugin(options: CmsVitePluginOptions): Plugin[] {
  const { clientConfig, serverConfig, userConfigPath } = options;

  const virtualModules: Record<string, string | ((ctx: LoadContext) => string)> = {
    // Everything the injected routes read, which no browser bundle imports. The
    // components are the ones lowered in Node, whose live `icon` and `editor`
    // drop out as JSON, so the server never loads the site's editors.
    "virtual:astronaut-cms/server": `\
export const client = ${JSON.stringify(clientConfig)};
export const server = ${JSON.stringify(serverConfig)};
export const components = ${JSON.stringify(options.components)};`,
    "virtual:astronaut-cms/local-storage": ({ devApi }) =>
      generateLocalStorageModule(options, devApi),
    "virtual:astronaut-cms/content": ({ watch }) =>
      generateContentModule(clientConfig, options.rootDir, watch),
    "virtual:astronaut-cms/user-config": generateUserConfigModule(userConfigPath, clientConfig),
    // The media config comes along so the resolver reads no config module, which
    // would take the whole admin config into a site island that resolves an asset.
    "virtual:astronaut-cms/assets": `export const media = ${JSON.stringify(assetsMedia(clientConfig.media))};\n${generateAssetsModule(clientConfig.media)}`,
  };

  const virtualModulesPlugin: Plugin = {
    name: "astronaut-cms:virtual-modules",
    enforce: "pre",

    resolveId(id) {
      if (id === COMPONENTS_MODULE) return options.componentsEntry;

      return id in virtualModules ? "\0" + id : undefined;
    },

    load(id) {
      const module = id.startsWith("\0") ? virtualModules[id.slice(1)] : undefined;

      if (typeof module !== "function") return module;

      return module({
        devApi: this.environment.name === DEV_API_ENVIRONMENT,
        watch: (path) => this.addWatchFile(path),
      });
    },

    // The asset maps import every library file lazily, only so a render loads no
    // more than it shows. A file the site also imports statically stays in its
    // chunk, which is fine, so the warning that it does says nothing to act on.
    onLog(_level, log) {
      return !(
        log.code === "INEFFECTIVE_DYNAMIC_IMPORT" &&
        log.ids?.includes("\0virtual:astronaut-cms/assets")
      );
    },
  };

  // The top-level `optimizeDeps` reaches only the client. A server environment,
  // such as one in workerd, would pre-bundle the licenses route, and the optimizer
  // cannot load its `?raw` imports. The scanner never sees the API route or the
  // editor stub, so finding them while rendering would reload the server mid-request.
  const optimizeDepsPlugin: Plugin = {
    name: "astronaut-cms:optimize-deps",
    configEnvironment: (name) => ({
      optimizeDeps: {
        exclude: ["astronaut-cms/licenses"],
        ...(name !== "client" && { include: ["astronaut-cms/endpoint", "astronaut-cms/internal"] }),
      },
    }),
  };

  return [editorStubPlugin(), virtualModulesPlugin, optimizeDepsPlugin];
}

/** What the site's resolver reads of the libraries, and so all a page that resolves an asset ships. */
function assetsMedia({ repo, s3 }: ClientMediaConfig): MediaRefConfig {
  return {
    repo: { directory: repo.directory },
    s3: s3 && { publicUrl: s3.publicUrl, ...(s3.directory != null && { directory: s3.directory }) },
  };
}

// The filesystem backend is Node-only, so it is linked in exactly where it runs:
// the dev API, which runs in Node whatever the adapter.
function generateLocalStorageModule(options: CmsVitePluginOptions, devApi: boolean): string {
  return options.serverConfig.storage.type === "local" && devApi
    ? `export { LocalStorage } from "astronaut-cms/server-local";`
    : `export const LocalStorage = null;`;
}

// Emits the lazy loader maps that back `astronaut-cms/assets`, keyed by
// root-absolute path, one glob over each library directory in the project. A
// file is never inlined as a data URL, which would lose its name as a download
// and its caching as a video. A build emits every file the globs match, and the
// integration deletes those nothing delivered links once the build is done.
//
// The object store has nothing to bundle: its files are never in the project, so
// the resolver hands back their URL and astro treats it as a remote image. Only a
// dev run standing in for the store with the working tree globs its directory
// too, exactly as it does the repository library's.
function generateAssetsModule(media: ClientMediaConfig): string {
  // join normalizes any leading/trailing slashes into a single root-absolute base.
  const bases = libraryDirectories(media).map((dir) => join("/", dir));
  // The glob arguments have to be static literals, which is why these live here
  // rather than in the (type-checked) resolver in src/assets/index.ts.
  const imagesGlob = JSON.stringify(
    bases.map((base) => `${base}/**/*.{${ASTRO_IMAGE_FORMATS.join(",")}}`),
  );
  const filesGlob = JSON.stringify(bases.map((base) => `${base}/**/*`));

  return `\
export const images = import.meta.glob(${imagesGlob}, { import: "default" });
export const files = import.meta.glob(${filesGlob}, { query: "?url&no-inline", import: "default" });`;
}

// What `astronaut-cms/content` reads: the order behind `sortEntries` and the
// content languages. File order is read off the file on every load and the file
// is watched, so an edit reaches the site without a restart.
function generateContentModule(
  { collections, contentI18n }: CmsClientConfig,
  rootDir: string,
  watch: (path: string) => void,
): string {
  const sorts: Record<string, CollectionSort> = {};
  const fileOrder: Record<string, string[]> = {};

  for (const { name, sort, loaderFileName } of Object.values(collections)) {
    if (sort !== "id") sorts[name] = sort;

    // A file sort is only accepted on a file() collection, which names its file.
    if (sort !== "file" || !loaderFileName) continue;

    const path = join(rootDir, loaderFileName);

    watch(path);

    fileOrder[name] = existsSync(path)
      ? [...parseMultiEntryFile(readFileSync(path, "utf-8"), getFileExtension(path)).entries.keys()]
      : [];
  }

  return `\
export const sorts = ${JSON.stringify(sorts)};
export const fileOrder = ${JSON.stringify(fileOrder)};
export const contentI18n = ${JSON.stringify(contentI18n)};`;
}

// The languages are inlined rather than imported from the content module, which
// watches the file-sorted collections and would reload the admin on every save.
function generateUserConfigModule(
  configPath: string | null,
  { contentI18n }: CmsClientConfig,
): string {
  if (!configPath) return "export const components = {};\nexport const collectionIcons = {};";
  return `\
import * as config from ${JSON.stringify(configPath)};
import { processCollectionIcons, processUserConfig } from "astronaut-cms/internal";
export const components = processUserConfig(config.components, ${JSON.stringify(contentI18n)});
export const collectionIcons = processCollectionIcons(config.collections);`;
}
