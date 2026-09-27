import { describe, expect, it } from "vitest";
import {
  isActiveContentType,
  isLibraryFile,
  mediaContentType,
  markdownImageUrl,
  mediaKind,
  mediaPath,
  mediaRef,
  remoteMediaUrl,
  uniqueMediaPath,
} from "@/shared/media";
import { ObjectStoreLibrary } from "@/server/media";
import { BindingStore, type MediaStore, type R2Binding } from "../src/media/store";

// One rule maps a library path to the string content stores, and back. The two
// backends spell it differently — a project path for a library in the
// repository, a bare key for one in an object store — and everything that reads
// or writes an asset value (the picker, entry validation, the resolver) goes
// through here, so the two spellings can never drift apart.

const repo = { mediaBackend: { type: "repo" } as const, mediaDirectory: "src/assets" };
const remote = {
  mediaBackend: { type: "remote", publicUrl: "https://cdn.example.com" } as const,
  mediaDirectory: "src/assets",
};
// `astro dev` may hold an object store's library in the working tree, which moves
// the bytes and nothing else: an entry edited there has to build unchanged.
const devLocal = {
  mediaBackend: { type: "remote", publicUrl: "https://cdn.example.com", local: true } as const,
  mediaDirectory: "src/assets",
};

function bindingStore(initial: Record<string, string>) {
  const objects = new Map(
    Object.entries(initial).map(([key, value]) => [
      key,
      { bytes: new TextEncoder().encode(value), etag: `"${value}"` },
    ]),
  );
  const bucket: R2Binding = {
    list: async ({ prefix = "" } = {}) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, size: value.bytes.byteLength, etag: value.etag })),
      truncated: false,
    }),
    head: async (key) => {
      const value = objects.get(key);

      return value ? { key, size: value.bytes.byteLength, etag: value.etag } : null;
    },
    get: async (key) => {
      const value = objects.get(key);

      if (!value) return null;

      return {
        etag: value.etag,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(value.bytes);
            controller.close();
          },
        }),
      };
    },
    put: async (key, _value, options) => {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;

      objects.set(key, { bytes: new Uint8Array(), etag: '"new"' });

      return { key };
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };

  return { objects, store: new BindingStore(bucket) };
}

describe("media paths", () => {
  it("round-trips a repository path", () => {
    expect(mediaRef("photos/hero.png", repo)).toBe("/src/assets/photos/hero.png");
    expect(mediaPath("/src/assets/photos/hero.png", repo)).toBe("photos/hero.png");
  });

  it("round-trips an object-store key", () => {
    expect(mediaRef("photos/hero.png", remote)).toBe("photos/hero.png");
    expect(mediaPath("photos/hero.png", remote)).toBe("photos/hero.png");
  });

  it("spells a locally served object-store library exactly like the store", () => {
    expect(mediaRef("photos/hero.png", devLocal)).toBe("photos/hero.png");
    expect(mediaPath("photos/hero.png", devLocal)).toBe("photos/hero.png");
    expect(mediaPath("/src/assets/photos/hero.png", devLocal)).toBeNull();
  });

  // A markdown image in an object-store library is its public URL, which astro
  // fetches, and which still has to read back as the key it serves.
  it("reads a public URL back as its key", () => {
    const url = markdownImageUrl("photos/a b.png", remote, "src/content/blog/post.md");

    expect(url).toBe("https://cdn.example.com/photos/a%20b.png");
    expect(mediaPath(url, remote)).toBe("photos/a b.png");
    expect(markdownImageUrl("photos/hero.png", repo, "src/content/blog/post.md")).toBe(
      "../../assets/photos/hero.png",
    );
  });

  it("rejects a value that does not address the library", () => {
    expect(mediaPath("/public/hero.png", repo)).toBeNull();
    expect(mediaPath("/src/assets/hero.png", remote)).toBeNull();
    expect(mediaPath("https://elsewhere.example/hero.png", remote)).toBeNull();
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
});

// The admin reads a library file from its public URL. The route answers a
// caller that asked it anyway with the same address, for a path the library
// admits to holding.
const libraryOf = (store: MediaStore) =>
  new ObjectStoreLibrary(
    store,
    {
      bucket: "b",
      publicUrl: "https://cdn.example.com",
      prefix: "lib/",
      access: { type: "binding", name: "MEDIA" },
    },
    { extensions: ["png"], maxFileSize: null },
  );

describe("reading a library", () => {
  const { store } = bindingStore({});

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
  function fakeStore() {
    const objects = new Map<string, number>([["lib/photos/hero.png", 12]]);

    return {
      objects,
      store: {
        list: (prefix: string) =>
          Promise.resolve(
            [...objects]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, size]) => ({ key, size })),
          ),
        head: (key: string) =>
          Promise.resolve(objects.has(key) ? { key, size: objects.get(key)! } : null),
        copy: (from: string, to: string, ifAbsent?: boolean) => {
          if (ifAbsent && objects.has(to)) return Promise.reject(new Error("PreconditionFailed"));

          objects.set(to, objects.get(from)!);

          return Promise.resolve();
        },
        remove: (key: string) => {
          objects.delete(key);

          return Promise.resolve();
        },
      } as unknown as MediaStore,
    };
  }

  it("round-trips a deletion back to its original path", async () => {
    const { objects, store } = fakeStore();
    const library = libraryOf(store);

    await library.deleteMedia("photos/hero.png");
    expect(objects.has("lib/photos/hero.png")).toBe(false);

    const [trashed] = await library.listTrash();
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

    objects.set("lib/photos/hero.png", 99);

    await expect(library.restoreMedia(trashed.id)).rejects.toThrow(/already exists/);
  });

  it("keeps an R2 trash object when its conditional restore is refused", async () => {
    const id = ".trash/1-photos/hero.png";
    const { objects, store } = bindingStore({
      [`lib/${id}`]: "old",
      "lib/photos/hero.png": "new",
    });

    await expect(libraryOf(store).restoreMedia(id)).rejects.toThrow(/already exists/);
    expect(objects.has(`lib/${id}`)).toBe(true);
    expect(new TextDecoder().decode(objects.get("lib/photos/hero.png")?.bytes)).toBe("new");
  });
});
