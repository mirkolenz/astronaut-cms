import { describe, expect, it } from "vitest";
import { mediaPath, mediaRef, remoteMediaUrl } from "@shared/media";

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
});
