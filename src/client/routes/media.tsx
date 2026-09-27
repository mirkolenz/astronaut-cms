import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMedia,
  useDeleteMedia,
  useRenameMedia,
  useReferenceIndex,
  useTrash,
  useRestoreMedia,
  usePurgeTrash,
} from "@/client/queries/use-media";
import config from "@/client/lib/config";
import {
  classifyUsage,
  describeReference,
  referencesFor,
  staleReferences,
  type AssetReference,
  type Usage,
} from "@/shared/references";
import { ErrorBanner } from "@/client/components/error-banner";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { MediaLightbox } from "@/client/components/media-lightbox";
import { PathDialog } from "@/client/components/path-dialog";
import { basename, dirname, join } from "pathe";
import { MediaThumbnail } from "@/client/components/media-thumbnail";
import {
  FolderCard,
  MediaBreadcrumbs,
  mediaPathRefusal,
  NewFolderButton,
  UploadButton,
  useMediaUpload,
} from "@/client/components/media-browser";
import { listDirectory } from "@/client/lib/entry-tree";
import type { MediaFile } from "@/shared/types";
import { isTransactionalMedia, mediaKind } from "@/shared/media";
import { Button } from "@/client/components/ui/button";

export const Route = createFileRoute("/media")({
  component: MediaLibrary,
});

function formatSize(bytes: number): string {
  if (bytes === 0) return "--";

  const [value, unit] =
    bytes < 1024 ? [bytes, "byte"] : bytes < 1024 ** 2 ? [bytes / 1024, "kilobyte"] : [bytes / 1024 ** 2, "megabyte"];

  return new Intl.NumberFormat(config.locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}

function MediaLibrary() {
  const { t } = useTranslation();
  const { data: files, isLoading, error } = useMedia();
  const deleteMutation = useDeleteMedia();
  const upload = useMediaUpload(files);
  const renameMutation = useRenameMedia();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [currentDir, setCurrentDir] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [lightboxFile, setLightboxFile] = useState<MediaFile | null>(null);
  const [unusedOnly, setUnusedOnly] = useState(false);

  const writeError = upload.mutation.error ?? deleteMutation.error ?? renameMutation.error;

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

  // Everything in this folder, before the unused filter narrows it to what is on screen.
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
    upload.mutation.mutate({ path: replaceTarget, file, overwrite: true });
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
                  count: usage.values().filter((kind) => kind === "orphan").reduce((count) => count + 1, 0),
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
            <Button type="button" variant="outline" size="sm" disabled={scanning} onClick={scan}>
              {scanning ? t(($) => $.media.scanningReferences) : t(($) => $.media.checkUsage)}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NewFolderButton dir={currentDir} onCreate={setCurrentDir} />
          <UploadButton state={upload} dir={currentDir} />
        </div>
      </div>

      <div className="mb-3">
        <MediaBreadcrumbs dir={currentDir} onNavigate={setCurrentDir} />
      </div>

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
          <FolderCard
            key={path}
            name={name}
            onOpen={() => setCurrentDir(path)}
            className="h-28"
          />
        ))}

        {/* File cards */}
        {currentFiles.map((file) => {
          return (
            <div
              key={file.path}
              className="group relative overflow-hidden rounded-lg border border-border"
            >
              {mediaKind(file.path) !== "file" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLightboxFile(file)}
                  className="flex h-28 w-full items-center justify-center rounded-none bg-muted cursor-pointer"
                  aria-label={`Preview ${basename(file.path)}`}
                >
                  <MediaThumbnail file={file} className="h-full w-full object-contain" />
                </Button>
              ) : (
                <div className="flex h-28 items-center justify-center bg-muted">
                  <MediaThumbnail file={file} />
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
                  {basename(file.path)}
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
        disabled={upload.mutation.isPending}
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

      {/* Rename dialog */}
      {renameTarget !== null && (
        <PathDialog
          title={t(($) => $.media.renameFile)}
          description={t(($) => $.media.current, { name: basename(renameTarget) })}
          initial={basename(renameTarget)}
          confirmLabel={t(($) => $.common.rename)}
          pendingLabel={t(($) => $.media.renaming)}
          isPending={renameMutation.isPending}
          requireChange
          validate={mediaPathRefusal}
          onSubmit={handleRename}
          onCancel={() => setRenameTarget(null)}
        >
          <ReferenceWarning
            references={referencesOf(renameTarget)}
            pending={scanPending}
            error={scanError}
            consequence={t(($) => $.media.renameReferenced)}
          />
        </PathDialog>
      )}

      <MediaLightbox file={lightboxFile} onClose={() => setLightboxFile(null)} />
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
