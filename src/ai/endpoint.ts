/**
 * Astro-route shell over the platform-agnostic relay in `handler.ts`. It supplies
 * the static config (from the virtual modules) and a runtime env reader, then
 * delegates to `handle`. Keeping the core framework-independent lets a true edge
 * function reuse it later (see the note in `handler.ts`).
 */
import type { APIRoute } from "astro";
import config from "virtual:astronaut-cms/config";
import aiServer from "virtual:astronaut-cms/ai-server";
import { accessConfig } from "../shared/access.ts";
import { envReader } from "../shared/runtime-env.ts";
import { handle } from "./handler.ts";

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(context.request, envReader(context), {
    ...accessConfig(config),
    ai: aiServer,
    models: config.ai?.models,
  });
