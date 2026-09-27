/**
 * Astro-route shell over the platform-agnostic token relay in `handler.ts`, in
 * the same shape as the AI and media shells: static config from the virtual
 * module, a runtime env reader, then delegate to `handle`.
 */
import type { APIRoute } from "astro";
import config from "virtual:astronaut-cms/config";
import { envReader } from "../shared/runtime-env.ts";
import { handle } from "./handler.ts";

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(context.request, envReader(context), config.github?.clientId);
