import { extname } from "pathe";
import { isImagePath } from "@client/lib/asset-utils";
import { mediaUrl } from "@client/lib/media";

/** A library file's thumbnail, or its file type when it has no preview. Decorative, so never captioned. */
export function MediaImage({ path, className }: { path: string; className?: string }) {
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
      src={mediaUrl(path)}
      alt=""
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
