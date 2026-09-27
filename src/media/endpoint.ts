/**
 * Astro-route shell over `handler.ts`, in the same shape as the AI and auth
 * relays: static config, an env reader and — on Cloudflare — a binding reader.
 */
import type { APIRoute } from "astro";
import config from "virtual:astronaut-cms/config";
import mediaConfig from "virtual:astronaut-cms/media-server";
import { accessConfig } from "../shared/access.ts";
import { bindingReader, envReader } from "../shared/runtime-env.ts";
import { handle } from "./handler.ts";

export const prerender = false;

const route: APIRoute = (context) =>
  handle(
    context.request,
    envReader(context),
    bindingReader(context),
    {
      ...accessConfig(config),
      media: mediaConfig,
      extensions: config.mediaExtensions,
      maxFileSize: config.maxFileSize,
    },
  );

export const POST = route;
/** Uploads a Workers binding could not presign (see `handler.ts`). */
export const PUT = route;
