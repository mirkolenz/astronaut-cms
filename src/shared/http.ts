/**
 * What every CMS-owned response and every CMS-owned request body has in common,
 * so no injected route has to restate it.
 */

/**
 * Hardening headers carried by every response the CMS serves. `nosniff` keeps a
 * body from being interpreted as something other than the type it declares, and
 * `no-referrer` keeps repository, entry and media paths out of the `Referer` of
 * everything the admin reaches.
 */
export const HARDENING_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/**
 * Marks a request that is about to change content, for the dev server's reload
 * suppression. Set by the admin rather than inferred from the method, because
 * every operation is a POST and only the caller knows which one it is sending.
 */
export const WRITE_HEADER = "x-astronaut-cms-write";

/** Thrown by {@link readBody} when a request body exceeds a route's limit. */
export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body is larger than the ${maxBytes} byte limit for this endpoint.`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * The body as it arrives, refusing anything over `maxBytes`. A route that
 * forwards a body to a paid upstream, spends a secret on it, or holds it in a
 * serverless instance's memory cannot let the caller choose its size, and
 * `content-length` is only a claim, so the stream is measured as it is read and
 * abandoned the moment it goes over.
 *
 * Yields the chunks rather than a body, so the two readers below each build the
 * shape they want without either paying for the other's.
 */
async function* chunks(request: Request, maxBytes: number): AsyncGenerator<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);

  const reader = request.body?.getReader();

  if (!reader) return;

  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.length;

    if (size > maxBytes) {
      await reader.cancel();

      throw new BodyTooLargeError(maxBytes);
    }

    yield value;
  }
}

/** The body as bytes, for an upload. */
export async function readBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of chunks(request, maxBytes)) {
    parts.push(chunk);
    size += chunk.length;
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}

/**
 * The body as text, for the routes whose bodies are JSON. Decoded as it arrives,
 * so a multi-byte character split across two chunks survives and the bytes are
 * never held twice.
 */
export async function readBody(request: Request, maxBytes: number): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  for await (const chunk of chunks(request, maxBytes)) {
    text += decoder.decode(chunk, { stream: true });
  }

  return text + decoder.decode();
}
