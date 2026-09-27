import {
  useCellValue,
  usePublisher,
  imageDialogState$,
  saveImage$,
  closeImageDialog$,
} from "@mdxeditor/editor";
import { useEntryContext } from "@/client/lib/entry-context";
import config from "@/client/lib/config";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { markdownImageUrl, type MediaLocation } from "@/shared/media";

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

  const handleSelect = (location: MediaLocation) =>
    saveImage({ src: markdownImageUrl(location, config.media, ctx?.contentFilePath) });

  return (
    <MediaPickerDialog open={isOpen} kind="image" onSelect={handleSelect} onCancel={closeDialog} />
  );
}
