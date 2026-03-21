import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import config from "virtual:astronaut-cms/config";
import {
  useMedia,
  useDeleteMedia,
  useUploadMedia,
  useReplaceMedia,
  useRenameMedia,
} from "@/client/queries/use-media";
import { ErrorBanner } from "@/client/components/error-banner";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { ImageLightbox } from "@/client/components/image-lightbox";
import { isImagePath, toPreviewUrl, getFileName } from "@/client/lib/asset-utils";
import { optimizeImage } from "@/client/lib/image-utils";
import { stripMediaPrefix } from "@/client/lib/storage/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";

export const Route = createFileRoute("/media")({
  component: MediaLibrary,
});

function formatSize(bytes: number): string {
  if (bytes === 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaLibrary() {
  const { t } = useTranslation();
  const { data: files, isLoading, error } = useMedia();
  const deleteMutation = useDeleteMedia();
  const uploadMutation = useUploadMedia();
  const replaceMutation = useReplaceMedia();
  const renameMutation = useRenameMedia();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [currentDir, setCurrentDir] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [duplicateFile, setDuplicateFile] = useState<{ path: string; file: File } | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  // Derive subdirectories and files relative to the media directory root
  const subdirs = new Set<string>();
  const currentFiles: typeof files = [];

  if (files) {
    const prefix = currentDir ? `${currentDir}/` : "";
    for (const file of files) {
      const relativePath = stripMediaPrefix(file.path, config.mediaDirectory);
      if (!relativePath.startsWith(prefix)) continue;
      const rest = relativePath.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx >= 0) {
        subdirs.add(rest.slice(0, slashIdx));
      } else {
        currentFiles.push(file);
      }
    }
  }

  const sortedSubdirs = [...subdirs].sort();

  // Breadcrumb segments
  const breadcrumbs = currentDir ? currentDir.split("/") : [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    setOptimizing(true);
    const file = await optimizeImage(rawFile);
    setOptimizing(false);
    const path = currentDir ? `${currentDir}/${file.name}` : file.name;
    const exists = currentFiles.some((f) => getFileName(f.path) === file.name);
    if (exists) {
      setDuplicateFile({ path, file });
      e.target.value = "";
      return;
    }
    await uploadMutation.mutateAsync({ path, file });
    e.target.value = "";
  };

  const handleOverwrite = async () => {
    if (!duplicateFile) return;
    const fullPath = `${config.mediaDirectory}/${duplicateFile.path}`;
    await replaceMutation.mutateAsync({ path: fullPath, file: duplicateFile.file });
    setDuplicateFile(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const relativePath = stripMediaPrefix(renameTarget, config.mediaDirectory);
    const dir = relativePath.includes("/")
      ? relativePath.slice(0, relativePath.lastIndexOf("/") + 1)
      : "";
    const newRelative = dir + renameValue.trim();
    await renameMutation.mutateAsync({
      oldPath: renameTarget,
      newPath: `${config.mediaDirectory}/${newRelative}`,
    });
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replaceTarget) return;
    await replaceMutation.mutateAsync({ path: replaceTarget, file });
    setReplaceTarget(null);
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t($ => $.media.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t($ => $.media.title)}</h1>
        <Button asChild>
          <label className="cursor-pointer">
            {optimizing ? t($ => $.common.optimizing) : uploadMutation.isPending ? t($ => $.common.uploading) : t($ => $.common.upload)}
            <input
              type="file"
              onChange={handleUpload}
              className="hidden"
              disabled={uploadMutation.isPending}
            />
          </label>
        </Button>
      </div>

      {/* Breadcrumb navigation */}
      {breadcrumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1 text-sm text-gray-500">
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => setCurrentDir("")}
          >
            {config.mediaDirectory}
          </Button>
          {breadcrumbs.map((segment, i) => {
            const path = breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <span>/</span>
                {isLast ? (
                  <span className="font-medium text-gray-700 dark:text-gray-300">{segment}</span>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => setCurrentDir(path)}
                  >
                    {segment}
                  </Button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {sortedSubdirs.length === 0 && currentFiles.length === 0 && (
        <div className="text-center text-gray-500">
          <p>{t($ => $.media.noFiles)}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Folder cards */}
        {sortedSubdirs.map((dir) => (
          <Button
            key={dir}
            type="button"
            variant="outline"
            onClick={() => setCurrentDir(currentDir ? `${currentDir}/${dir}` : dir)}
            className="flex h-28 flex-col items-center justify-center gap-2 hover:border-blue-400 hover:bg-blue-50 dark:hover:border-blue-600 dark:hover:bg-blue-950"
          >
            <span className="text-3xl text-gray-400">&#128193;</span>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{dir}</span>
          </Button>
        ))}

        {/* File cards */}
        {currentFiles.map((file) => {
          const isImage = isImagePath(file.path);
          return (
            <div
              key={file.path}
              className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              {isImage ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLightboxSrc(toPreviewUrl(file.path))}
                  className="flex h-28 w-full items-center justify-center rounded-none bg-gray-50 dark:bg-gray-900 cursor-pointer"
                  aria-label={`Preview ${getFileName(file.path)}`}
                >
                  <img
                    src={toPreviewUrl(file.path)}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Button>
              ) : (
                <div className="flex h-28 items-center justify-center bg-gray-50 dark:bg-gray-900">
                  <span className="text-2xl text-gray-400">
                    {file.path.split(".").pop()?.toUpperCase()}
                  </span>
                </div>
              )}
              {/* Hover action buttons */}
              <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="bg-black/50 text-white hover:bg-blue-600 hover:text-white"
                  onClick={() => {
                    setRenameTarget(file.path);
                    setRenameValue(getFileName(file.path));
                  }}
                >
                  {t($ => $.common.rename)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="bg-black/50 text-white hover:bg-blue-600 hover:text-white"
                  onClick={() => {
                    setReplaceTarget(file.path);
                    replaceInputRef.current?.click();
                  }}
                >
                  {t($ => $.common.replace)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="bg-black/50 text-white hover:bg-red-600 hover:text-white"
                  onClick={() => setDeleteTarget(file.path)}
                >
                  {t($ => $.common.delete)}
                </Button>
              </div>
              <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
                <p
                  className="truncate text-xs font-medium text-gray-700 dark:text-gray-300"
                  title={file.path}
                >
                  {getFileName(file.path)}
                </p>
                <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hidden file input for replace */}
      <input
        ref={replaceInputRef}
        type="file"
        onChange={handleReplace}
        className="hidden"
        disabled={replaceMutation.isPending}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t($ => $.media.deleteFile)}
        message={t($ => $.media.deleteFileMessage)}
        confirmLabel={t($ => $.common.delete)}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Overwrite confirmation */}
      <ConfirmDialog
        open={duplicateFile !== null}
        title={t($ => $.media.fileExists)}
        message={t($ => $.media.fileExistsMessage, { name: duplicateFile ? getFileName(duplicateFile.path) : "" })}
        confirmLabel={t($ => $.common.overwrite)}
        variant="danger"
        onConfirm={handleOverwrite}
        onCancel={() => setDuplicateFile(null)}
      />

      {/* Rename dialog */}
      {renameTarget !== null && (
        <RenameDialog
          currentName={getFileName(renameTarget)}
          value={renameValue}
          onChange={setRenameValue}
          isPending={renameMutation.isPending}
          onConfirm={handleRename}
          onCancel={() => {
            setRenameTarget(null);
            setRenameValue("");
          }}
        />
      )}

      <ImageLightbox
        open={lightboxSrc !== null}
        src={lightboxSrc ?? ""}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
}

function RenameDialog({
  currentName,
  value,
  onChange,
  isPending,
  onConfirm,
  onCancel,
}: {
  currentName: string;
  value: string;
  onChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t($ => $.media.renameFile)}</DialogTitle>
          <DialogDescription>{t($ => $.media.current, { name: currentName })}</DialogDescription>
        </DialogHeader>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm();
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t($ => $.common.cancel)}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || !value.trim() || value === currentName}
          >
            {isPending ? t($ => $.media.renaming) : t($ => $.common.rename)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
