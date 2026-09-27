import { isLibraryFile } from "@/shared/media";
import { validateMediaPath } from "@/shared/validation";
import { checked, HttpError } from "@/server/errors";

/** Admit a path to a media library before reading or writing it. */
export function assertLibraryPath(path: string, extensions: readonly string[] | null): void {
  checked(400, () => validateMediaPath(path));

  if (!isLibraryFile(path, extensions)) {
    throw new HttpError(`"${path}" is hidden or not of an allowed media type.`, 400);
  }
}
