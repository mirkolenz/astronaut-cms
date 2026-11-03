import { StorageBase } from "@/server/storage/base";
import type { BranchStatus, Precondition } from "@/server/storage/types";
import type { StorageOptions } from "@/server/storage/base";
import type { CollectionManifest, FileChange, MediaFile } from "@/shared/types";
import { repoMedia } from "@tests/fixtures/media";

/** The rest of the storage contract, for a test that only cares about its collections. */
const media = repoMedia([".png"]);

export const storageOptions = (collections: CollectionManifest): StorageOptions => ({
  collections,
  media,
  library: media.repo,
  components: {},
  login: "alice",
});

/**
 * A `StorageBase` with every abstract member answered, so a test only writes the
 * ones it exercises.
 *
 * Here rather than in each test file because the list is the storage contract:
 * when it grows, it grows in one place instead of breaking every test that
 * happened to subclass the real thing.
 */
export class StubStorage extends StorageBase {
  protected globPaths(): Promise<Iterable<string>> {
    return Promise.resolve([]);
  }
  listMedia(): Promise<MediaFile[]> {
    return Promise.resolve([]);
  }
  writeMedia() {
    return Promise.resolve();
  }
  moveMedia() {
    return Promise.resolve();
  }
  removeMedia() {
    return Promise.resolve();
  }
  readMedia(): Promise<never> {
    return Promise.reject(new Error("n/a"));
  }
  protected commitFile(
    _path: string,
    _content: string,
    _message: string,
    _precondition?: Precondition,
  ): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  protected removeFile(_path: string, _message: string, _expectedVersion?: string): Promise<void> {
    return Promise.resolve();
  }
  publish() {
    return Promise.resolve();
  }
  update() {
    return Promise.resolve();
  }
  discard() {
    return Promise.resolve();
  }
  getStatus(): Promise<BranchStatus> {
    return Promise.resolve({ branch: "", behind: 0 });
  }
  getChanges(): Promise<FileChange[]> {
    return Promise.resolve([]);
  }
}

/** A backend whose repository holds the paths in `tree`, recording the files it writes. */
export class TreeStorage extends StubStorage {
  tree: string[] = [];
  written: string[] = [];

  protected override globPaths(): Promise<string[]> {
    return Promise.resolve(this.tree);
  }

  protected override commitFile(path: string): Promise<undefined> {
    this.written.push(path);

    return Promise.resolve(undefined);
  }
}
