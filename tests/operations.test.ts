import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dispatch, operations } from "@/server/operations";
import type { RequestContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import { READ_ONLY_OPERATIONS, isWriteOperation } from "@/shared/operations";
import { ContentValidationError } from "@/shared/diagnostics";
import { changesetDigest } from "@/shared/digest";
import { referencesFor } from "@/shared/references";
import type { EntryMeta, FileChange } from "@/shared/types";

// The operation registry is the security boundary: a compromised admin can call
// anything here and nothing else. These pin the two properties that makes true —
// only registered names run, and every input is checked before a backend sees it.

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  const unreachable = () => {
    throw new Error("the backend should not have been reached");
  };

  return {
    session: { provider: "local", token: "", login: "test" },
    storage: new Proxy({}, { get: () => unreachable }) as RequestContext["storage"],
    media: () => new Proxy({}, { get: () => unreachable }) as never,
    ...overrides,
  };
}

describe("dispatch", () => {
  it("refuses a name that is not an operation", async () => {
    await expect(dispatch(context(), "deleteRepository", {})).rejects.toBeInstanceOf(HttpError);
  });

  // Looking the name up directly would make every inherited property callable.
  it("refuses a property of Object.prototype", async () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      await expect(dispatch(context(), name, {})).rejects.toBeInstanceOf(HttpError);
    }
  });

  it("checks the input before the backend is reached", async () => {
    await expect(dispatch(context(), "listEntries", {})).rejects.toBeInstanceOf(
      ContentValidationError,
    );
    await expect(dispatch(context(), "getEntry", { collection: "posts" })).rejects.toBeInstanceOf(
      ContentValidationError,
    );
    await expect(
      dispatch(context(), "saveEntry", { collection: "posts", id: "x", entry: { format: "exe" } }),
    ).rejects.toBeInstanceOf(ContentValidationError);
  });

  // A backend used to resolve an unknown name to the conventional directory for
  // it, which reads whatever happens to sit there. The collection set is fixed at
  // build time, so the name is checked against it here instead.
  it("refuses a collection the site does not declare", async () => {
    await expect(dispatch(context(), "listEntries", { collection: "blog" })).rejects.toBeInstanceOf(
      ContentValidationError,
    );
  });

  // A Zod dump is unreadable to an editor and useless to a model; findings are
  // what both of them act on.
  it("reports a schema failure as findings", async () => {
    await expect(dispatch(context(), "listEntries", {})).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ path: "collection" })],
    });
  });

  it("runs the operation once its input is valid", async () => {
    const listed = [{ id: "hello", collection: "posts", format: "md" as const }];
    const ctx = context({
      storage: {
        listEntries: () => Promise.resolve(listed),
      } as unknown as RequestContext["storage"],
    });

    await expect(dispatch(ctx, "listEntries", { collection: "posts" })).resolves.toEqual(listed);
  });

  // `READ_ONLY_OPERATIONS` lives in shared/ because the browser cannot import the
  // registry, so nothing links the two but this. A read misfiled as a write makes
  // the dev server swallow reloads and the assistant report changes it did not
  // make; a name that is not an operation at all is simply dead.
  it("classifies every operation as read or write", () => {
    const names = Object.keys(operations);

    for (const name of READ_ONLY_OPERATIONS) {
      expect(names, `${name} is not an operation`).toContain(name);
    }

    // Every write is a real operation too, by construction: the partition is
    // total, so this pins that the set never drifts into naming nothing.
    expect(names.filter((name) => !isWriteOperation(name)).sort()).toEqual(
      [...READ_ONLY_OPERATIONS].sort(),
    );
  });

  // The registry names CMS capabilities, never repository mechanics: no ref, no
  // commit, no provider parameter and no URL. That is what bounds the damage a
  // fully compromised admin can do, so it is asserted rather than left to review.
  it("exposes CMS capabilities only", () => {
    const forbidden = new Set(["ref", "sha", "branch", "commit", "url", "repo", "bucket", "token"]);

    for (const [name, operation] of Object.entries(operations)) {
      const shape = z.toJSONSchema(operation.schema, { io: "input", unrepresentable: "any" });

      for (const key of Object.keys(shape.properties ?? {})) {
        expect(forbidden.has(key), `${name} must not accept "${key}"`).toBe(false);
      }
    }
  });
});

describe("publish", () => {
  const changes: FileChange[] = [{ path: "posts/a.md", kind: "added", patch: "+a" }];

  function publishing() {
    const published: string[] = [];
    const storage = {
      getChanges: async () => changes,
      publish: async () => void published.push("published"),
    } as unknown as RequestContext["storage"];

    return { ctx: context({ storage }), published };
  }

  // A write after the review changes the digest, so what nobody saw never ships.
  it("publishes only the changeset that was reviewed", async () => {
    const { ctx, published } = publishing();

    await expect(dispatch(ctx, "publish", { digest: "stale" })).rejects.toMatchObject({
      status: 412,
    });
    expect(published).toEqual([]);

    await dispatch(ctx, "publish", { digest: await changesetDigest(changes) });
    expect(published).toEqual(["published"]);
  });
});

describe("media reference acknowledgements", () => {
  for (const name of ["deleteMedia", "renameMedia"] as const) {
    it(`${name} refuses newly added references after a review`, async () => {
      let ids = ["first"];
      const actions: string[] = [];
      const storage = {
        listEntries: async (collection: string) =>
          ids.map((id) => ({ collection, id, format: "md" as const, path: `src/content/blog/${id}.md` })),
        readEntry: async ({ id, path, format }: EntryMeta) => ({
          id,
          path,
          format,
          data: {},
          body: "![cover](../../assets/cover.png)",
        }),
      } as unknown as RequestContext["storage"];
      const media = {
        listPaths: async () => [{ path: "cover.png" }],
        deleteMedia: async () => void actions.push("delete"),
        renameMedia: async () => void actions.push("rename"),
      } as unknown as ReturnType<RequestContext["media"]>;
      const ctx = context({
        session: { provider: "local", token: "", login: `${name}-ack-test` },
        storage,
        media: () => media,
      });
      const file = { library: "repo" as const, path: "cover.png" };
      const input = name === "deleteMedia" ? file : { library: "repo", from: file.path, to: "moved.png" };

      await expect(dispatch(ctx, name, input)).rejects.toBeInstanceOf(ContentValidationError);

      const reviewed = referencesFor(await operations.getReferences.run(ctx, {}), file);

      ids = ["first", "second"];

      await expect(
        dispatch(ctx, name, { ...input, acknowledgedReferences: reviewed }),
      ).rejects.toMatchObject({ status: 412 });
      expect(actions).toEqual([]);

      const current = referencesFor(await operations.getReferences.run(ctx, {}), file);

      await dispatch(ctx, name, { ...input, acknowledgedReferences: current.toReversed() });
      expect(actions).toHaveLength(1);
    });
  }
});
