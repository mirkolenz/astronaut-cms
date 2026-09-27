/**
 * The tool catalog, bound to the admin's own runtime.
 *
 * Every binding — the in-app assistant's AI SDK tool set, the WebMCP surface —
 * projects this one object, so a tool added to the catalog reaches all of them
 * and none of them can offer something the others do not.
 */
import { call } from "@/client/lib/api";
import config from "@/client/lib/config";
import { createCmsTools } from "@/shared/tools/catalog";

// Safe at module scope: `bootstrap.ts` fills `config` in place before the admin
// chunk is imported.
export const cmsToolCatalog = createCmsTools({ call, config });
