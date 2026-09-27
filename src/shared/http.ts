/**
 * What every CMS-owned response and every CMS-owned request body has in common,
 * so no injected route has to restate it.
 */

/**
 * Hardening headers carried by every response the CMS serves. `nosniff` keeps a
 * body from being interpreted as something other than the type it declares, and
 * `no-referrer` keeps repository, entry and media paths out of the `Referer` of
 * everything the admin reaches.
 *
 * Deliberately no `Permissions-Policy`: WebMCP is gated by the `tools` feature,
 * which is allowed for a document's own origin only while nothing says
 * otherwise. Adding a policy here has to name `tools=(self)`, or the admin's
 * tool registration starts failing with `NotAllowedError`.
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

/** One `bytes=` range as a request spells it, a suffix when `start` is absent. */
export interface ByteRange {
  start?: number;
  end?: number;
}

/** How a range of a file is answered: 206 with its bytes, or 416 when none lie inside. */
export interface PartialContent {
  status: 206 | 416;
  contentRange: string;
  /** Inclusive offsets of the bytes to send, absent for a 416. */
  span?: { start: number; end: number };
}

/**
 * A single `bytes=` range, which is all a media element asks for. Anything else
 * reads as no range at all, and is answered with the whole file, exactly as a
 * server that ignores the header would.
 */
export function parseByteRange(header: string | null): ByteRange | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);

  if (!match || (!match[1] && !match[2])) return null;

  return {
    start: match[1] ? Number(match[1]) : undefined,
    end: match[2] ? Number(match[2]) : undefined,
  };
}

/** Settles a range against the size of the file it addresses. */
export function partialContent({ start, end }: ByteRange, size: number): PartialContent {
  const [first, last] =
    start === undefined
      ? [Math.max(size - (end ?? 0), 0), size - 1]
      : [start, Math.min(end ?? size - 1, size - 1)];

  if (first > last || first >= size) return { status: 416, contentRange: `bytes */${size}` };

  return {
    status: 206,
    contentRange: `bytes ${first}-${last}/${size}`,
    span: { start: first, end: last },
  };
}
