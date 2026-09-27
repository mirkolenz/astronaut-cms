import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMedia,
  useDeleteMedia,
  useUploadMedia,
  useRenameMedia,
  useReferenceIndex,
  useTrash,
  useRestoreMedia,
  usePurgeTrash,
} from "@client/queries/use-media";
import config from "@client/lib/config";
import {
  classifyUsage,
  describeReference,
  referencesFor,
  staleReferences,
  type AssetReference,
  type Usage,
} from "@shared/references";
import { ErrorBanner } from "@client/components/error-banner";
import { ConfirmDialog } from "@client/components/confirm-dialog";
import { ImageLightbox } from "@client/components/image-lightbox";
import { dirname, join } from "pathe";
import { isImagePath, getFileName } from "@client/lib/asset-utils";
import { MediaImage } from "@client/components/media-image";
import { dirSegments, listDirectory } from "@client/lib/entry-tree";
import { optimizeImage } from "@client/lib/image-utils";
import { mediaUrl } from "@client/lib/media";
import type { MediaFile } from "@shared/types";
import { isTransactionalMedia } from "@shared/media";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Input } from "@client/components/ui/input";

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
  const renameMutation = useRenameMedia();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [currentDir, setCurrentDir] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [lightboxFile, setLightboxFile] = useState<MediaFile | null>(null);
  const [duplicateFile, setDuplicateFile] = useState<{ path: string; file: File } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [unusedOnly, setUnusedOnly] = useState(false);

  const writeError = uploadMutation.error ?? deleteMutation.error ?? renameMutation.error;

  const { index, scanning, pending: scanPending, error: scanError, scan } = useReferenceIndex();
  const referencesOf = (path: string | null): AssetReference[] =>
    path && index ? referencesFor(index, path) : [];

  // Every destructive action needs to know what it would break, so opening one
  // asks for the index just as the usage view does.
  const askFor = (setTarget: (path: string) => void, path: string): void => {
    scan();
    setTarget(path);
  };

  // Library-wide, so it survives folder navigation and filter toggles.
  const { usage, stale } = useMemo(() => {
    const paths = files?.map((file) => file.path) ?? [];

    return {
      usage: index && classifyUsage(paths, index, config),
      stale: index ? staleReferences(index, paths) : [],
    };
  }, [files, index]);

  // Everything in this folder, before the unused filter: an upload has to be
  // checked against every name here, not only the ones currently on screen.
  const { folders, files: dirFiles } = useMemo(
    () => listDirectory(files ?? [], currentDir, (file) => file.path),
    [files, currentDir],
  );

  const currentFiles = useMemo(
    () =>
      unusedOnly && usage ? dirFiles.filter((file) => usage.get(file.path) === "orphan") : dirFiles,
    [dirFiles, unusedOnly, usage],
  );

  const usageLabel = (path: string): string => {
    const kind: Usage = usage?.get(path) ?? "orphan";

    if (kind === "always-included") return t(($) => $.media.alwaysIncluded);
    if (kind === "orphan") return t(($) => $.media.unused);

    return t(($) => $.media.uses, { count: referencesOf(path).length });
  };

  const breadcrumbs = dirSegments(currentDir);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    setOptimizing(true);
    const file = await optimizeImage(rawFile);
    setOptimizing(false);
    const path = currentDir ? `${currentDir}/${file.name}` : file.name;
    const exists = dirFiles.some((f) => getFileName(f.path) === file.name);
    e.target.value = "";

    if (exists) {
      setDuplicateFile({ path, file });
      return;
    }

    // `mutate`, not `mutateAsync`: a refused upload (the size limit, say) belongs
    // in the banner below rather than in an unhandled rejection.
    uploadMutation.mutate({ path, file });
  };

  const handleOverwrite = () => {
    if (!duplicateFile) return;
    uploadMutation.mutate({ ...duplicateFile, overwrite: true });
    setDuplicateFile(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ path: deleteTarget, force: true });
    setDeleteTarget(null);
  };

  const handleRename = (name: string) => {
    if (!renameTarget) return;

    renameMutation.mutate({
      oldPath: renameTarget,
      newPath: join(dirname(renameTarget), name),
      // The dialog above has just shown the editor what references this file,
      // which is exactly the acknowledgement the server asks for.
      force: true,
    });
    setRenameTarget(null);
  };

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replaceTarget) return;
    uploadMutation.mutate({ path: replaceTarget, file, overwrite: true });
    setReplaceTarget(null);
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t(($) => $.media.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t(($) => $.media.title)}</h1>
          {/* An object store has no draft branch: what is uploaded or deleted here
              is live at once, unlike a library in the repository. */}
          {!isTransactionalMedia(config.mediaBackend) && (
            <p className="text-xs text-muted-foreground">{t(($) => $.media.immediate)}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {usage ? (
            <>
              <span className="text-xs text-muted-foreground">
                {t(($) => $.media.unusedCount, {
                  count: [...usage.values()].filter((kind) => kind === "orphan").length,
                  total: usage.size,
                })}
              </span>
              <Button
                type="button"
                variant={unusedOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setUnusedOnly(!unusedOnly)}
              >
                {unusedOnly ? t(($) => $.media.allFiles) : t(($) => $.media.unusedOnly)}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={scan}
            >
              {scanning ? t(($) => $.media.scanningReferences) : t(($) => $.media.checkUsage)}
            </Button>
          )}
        </div>
        <Button asChild>
          <label className="cursor-pointer">
            {optimizing
              ? t(($) => $.common.optimizing)
              : uploadMutation.isPending
                ? t(($) => $.common.uploading)
                : t(($) => $.common.upload)}
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
        <nav className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
          <Button type="button" variant="link" size="xs" onClick={() => setCurrentDir("")}>
            {t(($) => $.media.title)}
          </Button>
          {breadcrumbs.map(({ name, path }, i) => (
            <span key={path} className="flex items-center gap-1">
              <span>/</span>
              {i === breadcrumbs.length - 1 ? (
                <span className="font-medium text-foreground">{name}</span>
              ) : (
                <Button type="button" variant="link" size="xs" onClick={() => setCurrentDir(path)}>
                  {name}
                </Button>
              )}
            </span>
          ))}
        </nav>
      )}

      {stale.length > 0 && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium">
            {t(($) => $.media.staleTitle, { count: stale.length })}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
            {stale.map((reference, i: number) => (
              <li key={i}>
                {reference.collection} / {reference.entryId} ({reference.where}) &rarr;{" "}
                <code>{reference.path}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scanError && (
        <ErrorBanner>
          {t(($) => $.media.referencesUnavailable, { message: scanError.message })}
        </ErrorBanner>
      )}

      {/* A refused write — the size limit, a store error — has nowhere else to surface. */}
      {writeError && <ErrorBanner>{writeError.message}</ErrorBanner>}

      {folders.length === 0 && currentFiles.length === 0 && !scanning && (
        <div className="text-center text-muted-foreground">
          <p>{unusedOnly ? t(($) => $.media.noUnused) : t(($) => $.media.noFiles)}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Folder cards */}
        {folders.map(({ name, path }) => (
          <Button
            key={path}
            type="button"
            variant="outline"
            onClick={() => setCurrentDir(path)}
            className="flex h-28 flex-col items-center justify-center gap-2 hover:border-accent-foreground/30 hover:bg-accent"
          >
            <span className="text-3xl text-muted-foreground">&#128193;</span>
            <span className="text-sm font-medium text-foreground">{name}</span>
          </Button>
        ))}

        {/* File cards */}
        {currentFiles.map((file) => {
          const isImage = isImagePath(file.path);
          return (
            <div
              key={file.path}
              className="group relative overflow-hidden rounded-lg border border-border"
            >
              {isImage ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLightboxFile(file)}
                  className="flex h-28 w-full items-center justify-center rounded-none bg-muted cursor-pointer"
                  aria-label={`Preview ${getFileName(file.path)}`}
                >
                  <MediaImage file={file} className="h-full w-full object-contain" />
                </Button>
              ) : (
                <div className="flex h-28 items-center justify-center bg-muted">
                  <MediaImage file={file} />
                </div>
              )}
              {/* Hover action buttons */}
              <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="bg-black/50 text-white hover:bg-blue-600 hover:text-white"
                  onClick={() => askFor(setRenameTarget, file.path)}
                >
                  {t(($) => $.common.rename)}
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
                  {t(($) => $.common.replace)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="bg-black/50 text-white hover:bg-red-600 hover:text-white"
                  onClick={() => askFor(setDeleteTarget, file.path)}
                >
                  {t(($) => $.common.delete)}
                </Button>
              </div>
              <div className="border-t border-border px-3 py-2">
                <p className="truncate text-xs font-medium text-foreground" title={file.path}>
                  {getFileName(file.path)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(file.size)}
                  {usage && ` · ${usageLabel(file.path)}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <TrashPanel />

      {/* Hidden file input for replace */}
      <input
        ref={replaceInputRef}
        type="file"
        onChange={handleReplace}
        className="hidden"
        disabled={uploadMutation.isPending}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t(($) => $.media.deleteFile)}
        message={
          <ReferenceWarning
            references={referencesOf(deleteTarget)}
            pending={scanPending}
            error={scanError}
            consequence={t(($) => $.media.deleteReferenced)}
            fallback={t(($) => $.media.deleteFileMessage)}
          />
        }
        confirmLabel={t(($) => $.common.delete)}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Overwrite confirmation */}
      <ConfirmDialog
        open={duplicateFile !== null}
        title={t(($) => $.media.fileExists)}
        message={t(($) => $.media.fileExistsMessage, {
          name: duplicateFile ? getFileName(duplicateFile.path) : "",
        })}
        confirmLabel={t(($) => $.common.overwrite)}
        variant="danger"
        onConfirm={handleOverwrite}
        onCancel={() => setDuplicateFile(null)}
      />

      {/* Rename dialog */}
      {renameTarget !== null && (
        <RenameDialog
          warning={
            <ReferenceWarning
              references={referencesOf(renameTarget)}
              pending={scanPending}
              error={scanError}
              consequence={t(($) => $.media.renameReferenced)}
            />
          }
          currentName={getFileName(renameTarget)}
          isPending={renameMutation.isPending}
          onConfirm={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      <ImageLightbox
        open={lightboxFile !== null}
        src={lightboxFile ? mediaUrl(lightboxFile.path, lightboxFile.version) : ""}
        onClose={() => setLightboxFile(null)}
      />
    </div>
  );
}

/**
 * Deletions that can still be undone.
 *
 * Renders nothing at all when there are none, which is also how a repository
 * library behaves: its deletions are a commit, so `listTrash` answers empty and
 * this never appears. No branch on the backend is needed here.
 */
function TrashPanel() {
  const { t } = useTranslation();
  const { data: trashed } = useTrash();
  const restore = useRestoreMedia();
  const purge = usePurgeTrash();
  const [open, setOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  if (!trashed?.length) return null;

  const target = trashed.find((file) => file.id === purgeTarget);

  return (
    <div className="mt-6 rounded-md border border-border">
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-between"
        onClick={() => setOpen(!open)}
      >
        <span>{t(($) => $.media.trashCount, { count: trashed.length })}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </Button>

      {open && (
        <div className="border-t border-border p-3">
          <p className="mb-3 text-xs text-muted-foreground">{t(($) => $.media.trashHint)}</p>

          <ul className="grid gap-2">
            {trashed.map((file) => (
              <li key={file.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={file.path}>
                    {file.path}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)} ·{" "}
                    {t(($) => $.media.deletedAt, {
                      when: new Date(file.deletedAt).toLocaleString(config.locale),
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ id: file.id })}
                >
                  {restore.isPending ? t(($) => $.media.restoring) : t(($) => $.media.restore)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setPurgeTarget(file.id)}
                >
                  {t(($) => $.media.purge)}
                </Button>
              </li>
            ))}
          </ul>

          {/* A restore refused because the name was taken again has nowhere else to go. */}
          {restore.error && <ErrorBanner>{restore.error.message}</ErrorBanner>}
          {purge.error && <ErrorBanner>{purge.error.message}</ErrorBanner>}
        </div>
      )}

      <ConfirmDialog
        open={target !== undefined}
        title={t(($) => $.media.purgeTitle)}
        message={t(($) => $.media.purgeMessage, { name: target?.path ?? "" })}
        confirmLabel={t(($) => $.common.delete)}
        variant="danger"
        onConfirm={() => {
          if (target) purge.mutate({ id: target.id });

          setPurgeTarget(null);
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}

/**
 * What content would break. A textual match is reported like any other: it is
 * weaker evidence, but the point here is to stop a destructive operation, not to
 * decide what to bundle.
 */
function ReferenceWarning({
  references,
  pending,
  error,
  consequence,
  fallback,
}: {
  references: AssetReference[];
  pending: boolean;
  /** A scan that never produced an answer, which must not read as "nothing references it". */
  error?: Error | null;
  consequence: string;
  fallback?: string;
}) {
  const { t } = useTranslation();

  if (error) return <>{t(($) => $.media.referencesUnavailable, { message: error.message })}</>;

  if (pending) return <>{t(($) => $.media.scanningReferences)}</>;

  if (references.length === 0) return <>{fallback ?? ""}</>;

  return (
    <>
      {t(($) => $.media.usedBy, { count: references.length })} {consequence}
      <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">
        {references.map((reference, i) => (
          <li key={i}>{describeReference(reference)}</li>
        ))}
      </ul>
    </>
  );
}

function RenameDialog({
  warning,
  currentName,
  isPending,
  onConfirm,
  onCancel,
}: {
  warning: React.ReactNode;
  currentName: string;
  isPending: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Owned here, so a keystroke re-renders the dialog rather than the whole library.
  const [value, setValue] = useState(currentName);

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(($) => $.media.renameFile)}</DialogTitle>
          <DialogDescription>{t(($) => $.media.current, { name: currentName })}</DialogDescription>
        </DialogHeader>
        {warning}
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t(($) => $.common.cancel)}
          </Button>
          <Button
            onClick={() => onConfirm(value.trim())}
            disabled={isPending || !value.trim() || value === currentName}
          >
            {isPending ? t(($) => $.media.renaming) : t(($) => $.common.rename)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
