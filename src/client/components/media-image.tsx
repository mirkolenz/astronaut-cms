import { extname } from "pathe";
import { isImagePath } from "@/client/lib/asset-utils";
import { mediaUrl } from "@/client/lib/media";
import type { MediaFile } from "@/shared/types";

/**
 * A library file's thumbnail, or its file type when it has no preview.
 * Decorative, so never captioned.
 *
 * Takes the listing's own record rather than a path, so the version travels with
 * it and a grid of these is served from the browser's cache on every visit after
 * the first.
 */
export function MediaImage({ file, className }: { file: MediaFile; className?: string }) {
  const { path } = file;
  const isImage = isImagePath(path);

  if (!isImage) {
    return (
      <span className="text-lg font-medium text-muted-foreground">
        {extname(path).slice(1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={mediaUrl(path, file.version)}
      alt=""
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
