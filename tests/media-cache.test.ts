import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "pathe";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "@/server/handler";
import { LocalStorage } from "@/server/storage/local";
import { API_MEDIA } from "@/shared/auth";

// What the admin may keep, decided by the file rather than by the caller. The
// version makes a library file's URL change with its contents, so an address
// that names the bytes that came back can be cached for good — and an address
// that names something else must not be, which is the case a `?v` alone would
// get wrong.

const NAME = "astronaut-cms-cache-fixture.svg";
const FILE = join(process.cwd(), "src/assets", NAME);
const BYTES = '<svg xmlns="http://www.w3.org/2000/svg" />';

// Matches the local backend's own naming of its bytes (SHA-256, hex).
async function digestOf(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));

  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const get = (query: string, headers: HeadersInit = {}) =>
  handle(
    new Request(`https://cms.test${API_MEDIA}/${NAME}${query}`, { headers }),
    () => undefined,
    () => undefined,
  );

beforeAll(async () => {
  await mkdir(join(process.cwd(), "src/assets"), { recursive: true });
  await writeFile(FILE, BYTES);
});

afterAll(async () => {
  await rm(FILE, { force: true });
});

describe("media caching", () => {
  it("keeps an addressed file for good and anything else for minutes", async () => {
    const version = await digestOf(BYTES);

    const addressed = await get(`?v=${version}`);
    const bare = await get("");
    // The case a check on the query parameter alone would get wrong: a caller
    // may append any `v` it likes, and only the file settles what it means.
    const wrong = await get("?v=not-this-file");

    expect(addressed.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(bare.headers.get("cache-control")).toBe("private, max-age=300");
    expect(wrong.headers.get("cache-control")).toBe("private, max-age=300");
    expect(bare.headers.get("etag")).toBe(`"${version}"`);
  });

  it("answers a revalidation with 304 and no body", async () => {
    const etag = `"${await digestOf(BYTES)}"`;
    const response = await get("", { "if-none-match": etag });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});

// A backend that would rather hand the browser a URL of its own. Its bytes are
// unreachable from here, so the redirect is what the CMS has to decide about:
// an address naming a version cannot be answered with one, since where it points
// is the provider's to expire.
describe("media a backend would redirect for", () => {
  const DESTINATION = "https://download.test/signed/x.svg";
  const PROXIED = "<svg />";

  function redirecting(version?: string) {
    vi.spyOn(LocalStorage.prototype, "readMedia").mockResolvedValue({
      redirect: DESTINATION,
      ...(version && { version }),
    });

    const fetched: string[] = [];

    vi.stubGlobal("fetch", (input: string) => {
      fetched.push(input);

      return Promise.resolve(new Response(PROXIED));
    });

    return fetched;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("redirects when the caller named no version", async () => {
    const fetched = redirecting("abc");
    const response = await get("");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DESTINATION);
    expect(fetched).toEqual([]);
  });

  it("serves the bytes itself when the caller named the version that came back", async () => {
    const fetched = redirecting("abc");
    const response = await get("?v=abc");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PROXIED);
    expect(fetched).toEqual([DESTINATION]);
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    // Typed from the name rather than from the answer, so a file served this way
    // is treated exactly as one the library stored itself — which for an SVG
    // means it is handed over as a download rather than run as a document.
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-disposition")).toBe("attachment");
  });

  it("redirects a backend that cannot name its bytes, whatever the caller appended", async () => {
    const fetched = redirecting();
    const response = await get("?v=abc");

    expect(response.status).toBe(302);
    expect(fetched).toEqual([]);
  });
});
