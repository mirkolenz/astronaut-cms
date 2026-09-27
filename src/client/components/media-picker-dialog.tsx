import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMedia, useUploadMedia } from "@/client/queries/use-media";
import { getFileName } from "@/client/lib/asset-utils";
import { MediaImage } from "@/client/components/media-image";
import { optimizeImage } from "@/client/lib/image-utils";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";

interface MediaPickerDialogProps {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function MediaPickerDialog({ open, onSelect, onCancel }: MediaPickerDialogProps) {
  const { t } = useTranslation();
  const { data: files, isLoading } = useMedia();
  const uploadMutation = useUploadMedia();
  const [filter, setFilter] = useState("");
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
    await uploadMutation.mutateAsync({ path: file.name, file });
    onSelect(file.name);
  };

  const handleOverwrite = async () => {
    if (!duplicateFile) return;

    const existing = files?.find((f) => getFileName(f.path) === duplicateFile.name);

    setDuplicateFile(null);

    if (!existing) return;

    await uploadMutation.mutateAsync({
      path: existing.path,
      file: duplicateFile.file,
      overwrite: true,
    });
    onSelect(existing.path);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(($) => $.media.selectMedia)}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(($) => $.media.filterPlaceholder)}
            className="flex-1"
          />
          <Button asChild>
            <label className="cursor-pointer">
              {uploadMutation.isPending ? t(($) => $.common.uploading) : t(($) => $.common.upload)}
              <input
                type="file"
                onChange={handleUpload}
                className="hidden"
                disabled={uploadMutation.isPending}
              />
            </label>
          </Button>
        </div>

        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {isLoading &&
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />
            ))}
          {filtered?.map((file) => {
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelect(file.path)}
                className="group flex flex-col overflow-hidden rounded-md border border-border transition-colors hover:border-ring"
              >
                <div className="flex h-20 items-center justify-center bg-muted">
                  <MediaImage file={file} className="h-full w-full object-contain" />
                </div>
                <div className="border-t border-border px-2 py-1">
                  <p className="truncate text-xs text-muted-foreground" title={file.path}>
                    {getFileName(file.path)}
                  </p>
                </div>
              </button>
            );
          })}
          {filtered?.length === 0 && !isLoading && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.media.noFilesFound)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t(($) => $.common.cancel)}
          </Button>
        </DialogFooter>

        <ConfirmDialog
          open={duplicateFile !== null}
          title={t(($) => $.media.fileExists)}
          message={t(($) => $.media.fileExistsMessage, { name: duplicateFile?.name ?? "" })}
          confirmLabel={t(($) => $.common.overwrite)}
          variant="danger"
          onConfirm={handleOverwrite}
          onCancel={() => setDuplicateFile(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
