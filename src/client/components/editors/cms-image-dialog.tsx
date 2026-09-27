import {
  useCellValue,
  usePublisher,
  imageDialogState$,
  saveImage$,
  closeImageDialog$,
} from "@mdxeditor/editor";
import { useEntryContext } from "@client/lib/entry-context";
import { toRelativeAssetPath } from "@client/lib/asset-utils";
import { MediaPickerDialog } from "@client/components/media-picker-dialog";

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

  const handleSelect = (assetPath: string) => {
    const src = ctx ? toRelativeAssetPath(ctx.contentFilePath, assetPath) : assetPath;
    saveImage({ src });
  };

  return <MediaPickerDialog open={isOpen} onSelect={handleSelect} onCancel={closeDialog} />;
}
