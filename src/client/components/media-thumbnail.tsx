import type { SyntheticEvent } from "react";
import { extname } from "pathe";
import { mediaUrl } from "@/client/lib/media";
import { mediaKind, type MediaLibraryId } from "@/shared/media";
import type { MediaFile } from "@/shared/types";

/**
 * A library file's thumbnail, or its file type when it has no preview.
 * Decorative, so never captioned.
 *
 * Takes the listing's own record rather than a path, so the version travels with
 * it and a grid of these is served from the browser's cache on every visit after
 * the first.
 */
export function MediaThumbnail({
  library,
  file,
  className,
}: {
  library: MediaLibraryId;
  file: MediaFile;
  className?: string;
}) {
  const { path } = file;
  const kind = mediaKind(path);
  const src = mediaUrl({ library, path }, file.version);
  const hide = (e: SyntheticEvent<HTMLElement>) => {
    e.currentTarget.style.display = "none";
  };

  // A video's thumbnail is its first frame, which `preload="metadata"` is enough
  // to paint without fetching the whole file.
  if (kind === "video") {
    return <video src={src} className={className} preload="metadata" muted onError={hide} />;
  }

  if (kind === "image") return <img src={src} alt="" className={className} onError={hide} />;

  return (
    <span className="text-lg font-medium text-muted-foreground">
      {extname(path).slice(1).toUpperCase()}
    </span>
  );
}
