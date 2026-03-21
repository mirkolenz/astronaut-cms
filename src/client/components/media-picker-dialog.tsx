import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useMedia } from "@/client/queries/use-media";
import { getStorage } from "@/client/lib/storage";
import { isImagePath, toPreviewUrl, getFileName } from "@/client/lib/asset-utils";
import { optimizeImage } from "@/client/lib/image-utils";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { useDialog } from "@/client/lib/use-dialog";

interface MediaPickerDialogProps {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function MediaPickerDialog({ open, onSelect, onCancel }: MediaPickerDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useDialog(open);
  const { data: files, isLoading } = useMedia();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [duplicateFile, setDuplicateFile] = useState<{ name: string; file: File } | null>(null);

  const filtered = open
    ? files?.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : undefined;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    const file = await optimizeImage(rawFile);
    const exists = files?.some((f) => getFileName(f.path) === file.name);
    if (exists) {
      setDuplicateFile({ name: file.name, file });
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const uploaded = await getStorage().uploadMedia(file.name, file);
      await queryClient.invalidateQueries({ queryKey: ["cms", "media"] });
      onSelect(uploaded.path);
    } finally {
      setUploading(false);
    }
  };

  const handleOverwrite = async () => {
    if (!duplicateFile) return;
    setUploading(true);
    try {
      const existing = files?.find((f) => getFileName(f.path) === duplicateFile.name);
      if (!existing) return;
      const replaced = await getStorage().replaceMedia(existing.path, duplicateFile.file);
      await queryClient.invalidateQueries({ queryKey: ["cms", "media"] });
      onSelect(replaced.path);
    } finally {
      setUploading(false);
      setDuplicateFile(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="rounded-lg border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      {open && (
        <div className="w-[48rem] max-w-[90vw] p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t($ => $.media.selectMedia)}</h2>

          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t($ => $.media.filterPlaceholder)}
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <label className="cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              {uploading ? t($ => $.common.uploading) : t($ => $.common.upload)}
              <input type="file" onChange={handleUpload} className="hidden" disabled={uploading} />
            </label>
          </div>

          <div className="mt-3 grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {isLoading &&
              [1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800"
                />
              ))}
            {filtered?.map((file) => {
              const isImage = isImagePath(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelect(file.path)}
                  className="group flex flex-col overflow-hidden rounded-md border border-gray-200 transition-colors hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600"
                >
                  <div className="flex h-20 items-center justify-center bg-gray-50 dark:bg-gray-800">
                    {isImage ? (
                      <img
                        src={toPreviewUrl(file.path)}
                        alt=""
                        className="h-full w-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="text-lg font-medium text-gray-400">
                        {file.path.split(".").pop()?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="border-t border-gray-200 px-2 py-1 dark:border-gray-700">
                    <p
                      className="truncate text-xs text-gray-600 dark:text-gray-400"
                      title={file.path}
                    >
                      {getFileName(file.path)}
                    </p>
                  </div>
                </button>
              );
            })}
            {filtered?.length === 0 && !isLoading && (
              <p className="col-span-full py-8 text-center text-sm text-gray-400">
                {t($ => $.media.noFilesFound)}
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={onCancel}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t($ => $.common.cancel)}
            </button>
          </div>

          <ConfirmDialog
            open={duplicateFile !== null}
            title={t($ => $.media.fileExists)}
            message={t($ => $.media.fileExistsMessage, { name: duplicateFile?.name ?? "" })}
            confirmLabel={t($ => $.common.overwrite)}
            variant="danger"
            onConfirm={handleOverwrite}
            onCancel={() => setDuplicateFile(null)}
          />
        </div>
      )}
    </dialog>
  );
}
