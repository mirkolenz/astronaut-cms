import { libraryPathError } from "@/shared/validation";
import { HttpError } from "@/server/errors";

/** Admit a path to a media library before reading or writing it. */
export function assertLibraryPath(path: string, extensions: readonly string[] | null): void {
  const error = libraryPathError(path, extensions);

  if (error) throw new HttpError(error, 400);
}
