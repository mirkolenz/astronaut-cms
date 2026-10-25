import { useState } from "react";
import { cn } from "cn";
import { useAssetUrl } from "@/client/queries/use-media";

/** A thumbnail of an image the content refers to, left out while there is none or it fails to load. */
export function AssetThumbnail({
  src,
  className,
}: {
  src: string | undefined;
  className?: string;
}) {
  const url = useAssetUrl(src);
  // Kept by its URL, so another image is tried again.
  const [failed, setFailed] = useState<string>();

  if (!url || url === failed) return null;

  return (
    <img
      src={url}
      alt=""
      className={cn("shrink-0 object-cover", className)}
      onError={() => setFailed(url)}
    />
  );
}
