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
  const entryFile = useEntryContext();

  const isOpen = state.type === "new" || state.type === "editing";

  // Another file for an image keeps its alt text, title and size.
  const handleSelect = (location: MediaLocation) =>
    saveImage({
      ...(state.type === "editing" ? state.initialValues : {}),
      src: markdownImageUrl(location, config.media, entryFile),
    });

  return (
    <MediaPickerDialog open={isOpen} kind="image" onSelect={handleSelect} onCancel={closeDialog} />
  );
}
