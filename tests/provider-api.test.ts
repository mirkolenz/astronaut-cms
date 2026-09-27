import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@/server/storage/api";
import { GitHubStorage } from "@/server/storage/github";
import { GitLabStorage } from "@/server/storage/gitlab";
import { getErrorStatus, StaleWriteError } from "@/server/storage/types";
import type { StorageOptions } from "@/server/storage/base";
import collections from "virtual:astronaut-cms/collections";

// The provider SDKs were 1.1 MB of runtime JavaScript for twenty-nine endpoints,
// so the CMS calls them over `fetch` instead. These pin what that hand-written
// client puts on the wire, which is the part an SDK used to get right for us.

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const calls: Call[] = [];

function stubFetch(
  responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
) {
  let next = 0;

  vi.stubGlobal("fetch", (input: URL | string, init?: RequestInit) => {
    const {
      status = 200,
      body = {},
      headers = {},
    } = responses[Math.min(next++, responses.length - 1)];

    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  });
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const options: StorageOptions = {
  collections,
  mediaDirectory: "src/assets",
  mediaExtensions: [".png"],
  maxFileSize: null,
  login: "alice",
};

describe("ApiClient", () => {
  it("builds the URL, query and headers, and sends JSON only with a body", async () => {
    stubFetch([{ body: { ok: true } }]);

    const api = new ApiClient("https://api.example.com/v4/", { authorization: "Bearer t" });

    await api.json({ path: "/things", query: { page: 2, skip: undefined, flag: true } });

    expect(calls[0].url).toBe("https://api.example.com/v4/things?page=2&flag=true");
    expect(calls[0].headers.authorization).toBe("Bearer t");
    expect(calls[0].headers["content-type"]).toBeUndefined();

    await api.run({ path: "things", method: "POST", body: { a: 1 } });

    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers["content-type"]).toBe("application/json");
    expect(calls[1].body).toBe('{"a":1}');
  });

  // Every caller that branches on a provider failure reads the status off the
  // error, so a failed call has to carry it rather than becoming a generic throw.
  it("raises the provider's status and message", async () => {
    stubFetch([{ status: 409, body: { message: "Merge conflict" } }]);

    const error = await new ApiClient("https://api.example.com", {})
      .json({ path: "x" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(getErrorStatus(error)).toBe(409);
    expect((error as ApiError).message).toBe("Merge conflict");
  });
});

describe("GitHub requests", () => {
  const storage = () =>
    new GitHubStorage(
      { owner: "acme", repo: "site", branch: "main", publishMode: "direct" },
      options,
      "ghu_token",
    );

  it("addresses the draft branch ref and the recursive tree of the ref it resolves to", async () => {
    stubFetch([{ status: 404, body: { message: "Not Found" } }, { body: { tree: [] } }]);

    await storage().listEntries("posts");

    expect(calls[0].url).toBe("https://api.github.com/repos/acme/site/git/ref/heads/cms/alice");
    // The draft branch is absent, so the listing falls back to the default branch.
    expect(calls[1].url).toBe("https://api.github.com/repos/acme/site/git/trees/main?recursive=1");
    expect(calls[1].headers["x-github-api-version"]).toBe("2022-11-28");
  });

  // A media file's name routinely holds a space or a `#`, either of which would
  // address something other than the file if it reached the URL raw.
  it("encodes each path segment of a repository file", async () => {
    stubFetch([
      { status: 404, body: {} },
      { body: { type: "file", sha: "s", download_url: "https://raw.example/a" } },
    ]);

    await storage().readMedia("photos/a b#1.png");

    expect(calls[1].url).toBe(
      "https://api.github.com/repos/acme/site/contents/src/assets/photos/a%20b%231.png?ref=main",
    );
    expect(calls[1].headers.accept).toBe("application/vnd.github.object+json");
  });

  it("reads large file contents from the blob API", async () => {
    stubFetch([
      { status: 404, body: {} },
      { body: { type: "file", sha: "large", content: "", encoding: "none" } },
      {
        body: {
          content: btoa("---\ntitle: Large\n---\n\nBody\n"),
          encoding: "base64",
        },
      },
    ]);

    const entry = await storage().getEntry("posts", "large", "md");

    expect(entry.data).toEqual({ title: "Large" });
    expect(entry.body).toBe("\nBody\n");
    expect(calls[2].url).toBe("https://api.github.com/repos/acme/site/git/blobs/large");
  });

  it("does not turn a failed repository listing into an empty repository", async () => {
    stubFetch([
      { status: 404, body: {} },
      { status: 503, body: { message: "Unavailable" } },
    ]);

    await expect(storage().listEntries("posts")).rejects.toMatchObject({ status: 503 });
  });

  it("checks the source and destination against the same parent before moving media", async () => {
    stubFetch([
      { body: {} },
      { body: { type: "file", sha: "source" } },
      { body: { object: { sha: "parent" } } },
      { body: { type: "file", sha: "changed" } },
      { status: 404, body: {} },
      { body: { tree: { sha: "tree" } } },
    ]);

    await expect(storage().renameMedia("source.png", "target.png")).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect(calls[3].url).toContain("contents/src/assets/source.png?ref=parent");
    expect(calls[4].url).toContain("contents/src/assets/target.png?ref=parent");
    expect(calls).not.toContainEqual(
      expect.objectContaining({ method: "POST", url: expect.stringContaining("/git/trees") }),
    );
  });
});

describe("GitLab requests", () => {
  const storage = () =>
    new GitLabStorage(
      {
        project: "group/site",
        branch: "main",
        instanceUrl: "https://gitlab.com",
        publishMode: "direct",
      },
      options,
      "glpat",
    );

  it("encodes the project path as one segment", async () => {
    stubFetch([{ status: 404, body: {} }, { body: [] }]);

    await storage().listEntries("posts");

    expect(calls[0].url).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fsite/repository/branches/cms%2Falice",
    );
  });

  // GitLab pages this endpoint, so a repository larger than one page would
  // otherwise be listed down to its first hundred files.
  it("follows the tree listing across pages", async () => {
    stubFetch([
      { status: 404, body: {} },
      { body: [{ type: "blob", path: "src/content/blog/a.md" }], headers: { "x-next-page": "2" } },
      { body: [{ type: "blob", path: "src/content/blog/b.md" }] },
    ]);

    const entries = await storage().listEntries("posts");

    expect(calls[1].url).toContain("page=1");
    expect(calls[2].url).toContain("page=2");
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("does not turn a failed repository listing into an empty repository", async () => {
    stubFetch([
      { status: 404, body: {} },
      { status: 503, body: { message: "Unavailable" } },
    ]);

    await expect(storage().listEntries("posts")).rejects.toMatchObject({ status: 503 });
  });
});
