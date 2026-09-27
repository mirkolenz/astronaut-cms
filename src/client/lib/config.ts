/**
 * The admin's configuration, delivered at runtime rather than bundled.
 *
 * It used to be a build-time virtual module, which put the store origin, the
 * preview URL, the model list and the rest into a chunk any anonymous visitor
 * could fetch by URL. Nothing in it is a credential, but it is an inventory of
 * the deployment, so it is served by the session probe instead and reaches the
 * browser only once the server has recognised the editor.
 *
 * The object is filled in place, so the usual `import config from` still reads
 * the live values. {@link setConfig} runs in `bootstrap.ts` before the admin
 * chunk is imported, which is what makes a read at module scope safe.
 */
import type { CmsClientConfig } from "@/integration/types";

const config = {} as CmsClientConfig;

export function setConfig(value: CmsClientConfig): void {
  Object.assign(config, value);
}

export default config;
