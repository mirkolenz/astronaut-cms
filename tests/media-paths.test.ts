import { assert, describe, expect, it } from "vitest";
import {
  isActiveContentType,
  isLibraryFile,
  mediaContentType,
  markdownImageUrl,
  mediaKind,
  mediaPath,
  mediaRef,
  remoteMediaUrl,
  servedContentType,
  sizeLimitError,
  uniqueMediaPath,
} from "@/shared/media";
import { ObjectStoreLibrary } from "@/server/media";
import type { MediaStore } from "@/media/s3-store";

import { repoMedia, s3Media } from "./fixtures/media";

// One rule maps a library file to the string content stores, and back. The two
// libraries spell it differently, a project path for the repository and the
// public URL for the object store, and everything that reads or writes an asset
// value (the picker, entry validation, the resolver) goes through here, so the
// two spellings can never drift apart.

const repo = repoMedia();
const both = s3Media();

describe("media paths", () => {
  it("round-trips a repository path", () => {
    expect(mediaRef({ library: "repo", path: "photos/hero.png" }, both)).toBe(
      "/src/assets/photos/hero.png",
    );
    expect(mediaPath("/src/assets/photos/hero.png", both)).toEqual({
      library: "repo",
      path: "photos/hero.png",
    });
  });

  // The public URL is what astro resolves itself, and has to read back as the key it serves.
  it("round-trips an object-store URL", () => {
    const url = mediaRef({ library: "s3", path: "photos/a b.png" }, both);

    expect(url).toBe("https://cdn.example.com/photos/a%20b.png");
    expect(mediaPath(url, both)).toEqual({ library: "s3", path: "photos/a b.png" });
    expect(markdownImageUrl({ library: "s3", path: "photos/a b.png" }, both, "src/content/blog/post.md")).toBe(url);
  });

  // `astro dev` may hold the object store in the working tree, which moves the
  // bytes and nothing else: an entry edited there has to build unchanged.
  it("spells a locally served object store exactly like the store", () => {
    expect(mediaRef({ library: "s3", path: "hero.png" }, s3Media(".astronaut-cms/s3"))).toBe(
      "https://cdn.example.com/hero.png",
    );
  });

  it("writes a repository markdown image relative to the entry", () => {
    expect(
      markdownImageUrl({ library: "repo", path: "photos/hero.png" }, both, "src/content/blog/post.md"),
    ).toBe("../../assets/photos/hero.png");
  });

  it("rejects a value that does not address a library", () => {
    expect(mediaPath("/public/hero.png", both)).toBeNull();
    expect(mediaPath("photos/hero.png", both)).toBeNull();
    expect(mediaPath("https://elsewhere.example/hero.png", both)).toBeNull();
    expect(mediaPath("https://cdn.example.com/hero.png", repo)).toBeNull();
  });

  // Bounds may overlap between libraries, and each refuses only what falls outside its own.
  it("refuses a file outside a library's size bounds", () => {
    const limits = { minFileSize: 5 * 1024 * 1024, maxFileSize: 10 * 1024 * 1024 };

    expect(sizeLimitError(7 * 1024 * 1024, limits)).toBeNull();
    expect(sizeLimitError(1024, limits)).toMatch(/smaller than the 5 MB minimum/);
    expect(sizeLimitError(11 * 1024 * 1024, limits)).toMatch(/larger than the 10 MB limit/);
  });

  it("serves a key under the public base", () => {
    expect(remoteMediaUrl("photos/hero.png", "https://cdn.example.com/")).toBe(
      "https://cdn.example.com/photos/hero.png",
    );
  });

  // An upload nobody can be asked about must land beside an existing file rather
  // than replace it.
  it("numbers a taken name until it is free", () => {
    const taken = new Set(["logo.png", "logo-2.png", "photos/hero.png"]);

    expect(uniqueMediaPath("logo.png", taken)).toBe("logo-3.png");
    expect(uniqueMediaPath("photos/hero.png", taken)).toBe("photos/hero-2.png");
    expect(uniqueMediaPath("notes", taken)).toBe("notes");
  });
});

describe("media types", () => {
  it("admits any visible file unless the library is restricted", () => {
    expect(isLibraryFile("films/2026/teaser.mp4", null)).toBe(true);
    expect(isLibraryFile("../assets/photo.png", null)).toBe(true);
    expect(isLibraryFile("films/.DS_Store", null)).toBe(false);
    expect(isLibraryFile(".trash/1-x.png", null)).toBe(false);
    expect(isLibraryFile("brief.pdf", [".png"])).toBe(false);
  });

  it("previews by the type a file is served with", () => {
    expect(mediaKind("a/b/hero.PNG")).toBe("image");
    expect(mediaKind("teaser.webm")).toBe("video");
    expect(mediaKind("episode.m4a")).toBe("audio");
    expect(mediaKind("captions.vtt")).toBe("file");
    expect(mediaContentType("archive.unknown-ext")).toBe("application/octet-stream");
  });

  it("treats every document type a browser would run as active", () => {
    expect(isActiveContentType(mediaContentType("logo.svg"))).toBe(true);
    expect(isActiveContentType(mediaContentType("page.html"))).toBe(true);
    expect(isActiveContentType(mediaContentType("page.xhtml"))).toBe(true);
    expect(isActiveContentType(mediaContentType("teaser.mp4"))).toBe(false);
  });

  it("serves only what the admin previews with its own type", () => {
    expect(servedContentType("logo.svg")).toBe("image/svg+xml");
    expect(servedContentType("teaser.mp4")).toBe("video/mp4");
    expect(servedContentType("app.js")).toBe("application/octet-stream");
    expect(servedContentType("page.html")).toBe("application/octet-stream");
  });
});

/** A store that keeps only sizes, and refuses a conditional copy onto a taken key as S3 does. */
function fakeStore() {
  const objects = new Map<string, number>([["lib/photos/hero.png", 12]]);
  const store: MediaStore = {
    list: async (prefix) =>
      [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, size]) => ({ key, size })),
    head: async (key) => {
      const size = objects.get(key);

      return size === undefined ? null : { key, size };
    },
    presignUpload: async (key) => ({ url: `https://s3.example.com/${key}`, headers: {} }),
    copy: async (from, to, ifAbsent) => {
      if (ifAbsent && objects.has(to)) throw new Error("PreconditionFailed");

      objects.set(to, objects.get(from) ?? 0);
    },
    remove: async (key) => {
      objects.delete(key);
    },
  };

  return { objects, store };
}

// The admin reads a library file from its public URL. The route answers a
// caller that asked it anyway with the same address, for a path the library
// admits to holding.
const libraryOf = (store: MediaStore) =>
  new ObjectStoreLibrary(
    store,
    {
      publicUrl: "https://cdn.example.com",
      prefix: "lib/",
      s3: { endpoint: "https://s3.example.com", region: "auto", pathStyle: true, bucket: "b" },
    },
    repoMedia(["png"]).repo,
  );

describe("reading a library", () => {
  const { store } = fakeStore();

  it("sends a read to the public URL", async () => {
    await expect(libraryOf(store).readMedia("photos/a b.png")).resolves.toEqual({
      redirect: "https://cdn.example.com/photos/a%20b.png",
    });
  });

  // A read may no more reach the prefix the library keeps for itself, or climb
  // out of its root, than a write may.
  it("refuses a reserved or escaping path", async () => {
    await expect(libraryOf(store).readMedia(".trash/hero.png")).rejects.toThrow(/hidden/);
    await expect(libraryOf(store).readMedia("../secrets.png")).rejects.toThrow();
  });
});

// An object store keeps no history, so the trash is the only thing standing
// between a wrong delete and a lost file. What it stores has to survive the
// round trip: the original path, and nothing a caller could have spelled.
describe("the trash", () => {
  it("round-trips a deletion back to its original path", async () => {
    const { objects, store } = fakeStore();
    const library = libraryOf(store);

    await library.deleteMedia("photos/hero.png");
    expect(objects.has("lib/photos/hero.png")).toBe(false);

    const [trashed] = await library.listTrash();
    assert(trashed);
    expect(trashed.path).toBe("photos/hero.png");

    await library.restoreMedia(trashed.id);
    expect(objects.has("lib/photos/hero.png")).toBe(true);
    expect(await library.listTrash()).toEqual([]);
  });

  it("refuses an id the library never issued", async () => {
    const library = libraryOf(fakeStore().store);

    await expect(library.restoreMedia("photos/hero.png")).rejects.toThrow(/not a deleted file/);
    await expect(library.purgeTrash("../elsewhere")).rejects.toThrow(/not a deleted file/);
    await expect(library.purgeTrash(".trash/1-../photos/hero.png")).rejects.toThrow(/not a deleted file/);
    await expect(library.purgeTrash(".trash/01-photos/hero.png")).rejects.toThrow(/not a deleted file/);
  });

  it("refuses a restore onto a name taken since", async () => {
    const { objects, store } = fakeStore();
    const library = libraryOf(store);

    await library.deleteMedia("photos/hero.png");
    const [trashed] = await library.listTrash();
    assert(trashed);

    objects.set("lib/photos/hero.png", 99);

    await expect(library.restoreMedia(trashed.id)).rejects.toThrow(/already exists/);
  });

  it("keeps the trash object when its conditional restore is refused", async () => {
    const id = ".trash/1-photos/hero.png";
    const { objects, store } = fakeStore();

    objects.set(`lib/${id}`, 3);

    await expect(libraryOf(store).restoreMedia(id)).rejects.toThrow(/already exists/);
    expect(objects.has(`lib/${id}`)).toBe(true);
    expect(objects.get("lib/photos/hero.png")).toBe(12);
  });
});
