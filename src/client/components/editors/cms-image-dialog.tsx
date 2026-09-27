import {
  useCellValue,
  usePublisher,
  imageDialogState$,
  saveImage$,
  closeImageDialog$,
} from "@mdxeditor/editor";
import { useEntryContext } from "@/client/lib/entry-context";
import { toRelativeAssetPath } from "@/client/lib/asset-utils";
import config from "@/client/lib/config";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { mediaRef, remoteMediaUrl } from "@/shared/media";

/**
 * Custom ImageDialog for MDXEditor's imagePlugin.
 * Reads state from MDXEditor's internal signals and wraps the CMS MediaPickerDialog.
 */
export function CmsImageDialog() {
  const state = useCellValue(imageDialogState$);
  const saveImage = usePublisher(saveImage$);
  const closeDialog = usePublisher(closeImageDialog$);
  const ctx = useEntryContext();

  const isOpen = state.type === "new" || state.type === "editing";

  const handleSelect = (path: string) => saveImage({ src: markdownImageSrc(path, ctx?.contentFilePath) });

  return (
    <MediaPickerDialog open={isOpen} kind="image" onSelect={handleSelect} onCancel={closeDialog} />
  );
}

/**
 * A markdown image is astro's to resolve, so it is spelled the way astro reads
 * one: relative to the entry for a repository library, and as the public URL for
 * an object store, whose keys mean nothing to astro.
 */
function markdownImageSrc(path: string, contentFilePath: string | undefined): string {
  const { mediaBackend } = config;

  if (mediaBackend.type === "remote") return remoteMediaUrl(path, mediaBackend.publicUrl);

  const ref = mediaRef(path, config);

  return contentFilePath ? toRelativeAssetPath(contentFilePath, ref.slice(1)) : ref;
}
