import {
  assertWithinSizeLimit,
  MEDIA_API_BASE,
  remoteMediaUrl,
  type UploadTarget,
} from "@shared/media";
import config from "virtual:astronaut-cms/config";
import { validateMediaPath } from "@shared/validation";
import type { MediaFile } from "@shared/types";
import { siteUrl } from "@client/lib/site-url";
import { authedSiteFetch } from "@client/lib/site-fetch";
import type { MediaBackend } from "./types";

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: { message?: string } };

    throw new Error(error?.message ?? `Media request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

/**
 * The media library of an object store, reached through the injected route
 * because no bucket credential may exist in a browser bundle. An upload asks the
 * route where to put the bytes, then sends them straight to the store.
 */
export class RemoteMedia implements MediaBackend {
  // An object is written the moment it is uploaded, and no draft branch holds it.
  readonly transactional = false;

  // Resolved at construction, not import: `siteUrl` needs a browser, and this
  // module is loaded wherever the storage backends are.
  private readonly endpoint = siteUrl(MEDIA_API_BASE);

  /** The base its keys are publicly served under. */
  private readonly publicUrl: string;

  constructor(publicUrl: string) {
    this.publicUrl = publicUrl;
  }

  private async call<T>(body: unknown): Promise<T> {
    return unwrap<T>(
      await authedSiteFetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async listMedia(): Promise<MediaFile[]> {
    const { files } = await this.call<{ files: MediaFile[] }>({ action: "list" });

    return files;
  }

  /** A public bucket needs no round trip: the key is the URL. */
  async readUrl(path: string): Promise<string> {
    return remoteMediaUrl(path, this.publicUrl);
  }

  async uploadMedia(path: string, file: File): Promise<void> {
    validateMediaPath(path);
    assertWithinSizeLimit(file.size, config.maxFileSize);

    const target = await this.call<UploadTarget>({
      action: "upload",
      path,
      size: file.size,
    });

    // The Git token rides along only on the proxied form, never on the store's own URL.
    const response = target.proxy
      ? await authedSiteFetch(`${this.endpoint}?path=${encodeURIComponent(path)}`, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        })
      : await fetch(target.url, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });

    if (!response.ok) throw new Error(`Upload failed (${response.status})`);
  }

  async renameMedia(from: string, to: string): Promise<void> {
    validateMediaPath(from);
    validateMediaPath(to);

    await this.call({ action: "rename", from, to });
  }

  async deleteMedia(path: string): Promise<void> {
    validateMediaPath(path);

    await this.call({ action: "delete", path });
  }
}
