/**
 * The media library, as everything above the storage layer addresses it. The
 * backend itself is constructed in `storage/index.ts`, since a repository
 * library and the storage backend are the same object.
 */
export { getMedia } from "@client/lib/storage";
