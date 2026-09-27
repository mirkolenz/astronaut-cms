import { StorageBase } from "@server/storage/base";
import type { BranchStatus } from "@server/storage/types";
import type { EntryMeta, FileChange, MediaFile } from "@shared/types";

/**
 * A `StorageBase` with every abstract member answered, so a test only writes the
 * ones it exercises.
 *
 * Here rather than in each test file because the list is the storage contract:
 * when it grows, it grows in one place instead of breaking every test that
 * happened to subclass the real thing.
 */
export class StubStorage extends StorageBase {
  listEntries(): Promise<EntryMeta[]> {
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
    _expectedVersion?: string,
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
