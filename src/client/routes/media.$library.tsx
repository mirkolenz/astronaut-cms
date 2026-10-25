import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { basename, dirname, join } from "pathe";
import { ImageOff, Pencil, Replace, Trash2 } from "lucide-react";
import {
  mediaQuery,
  trashQuery,
  useMedia,
  useDeleteMedia,
  useRenameMedia,
  useReferenceIndex,
  useTrash,
  useRestoreMedia,
  usePurgeTrash,
} from "@/client/queries/use-media";
import config from "@/client/lib/config";
import { preload } from "@/client/lib/query-client";
import { listDirectory } from "@/client/lib/entry-tree";
import { formatSize, libraryLabel } from "@/client/lib/media";
import { usePathRefusal } from "@/client/hooks/use-path-refusal";
import { useRunMutation } from "@/client/hooks/use-run-mutation";
import {
  describeReference,
  referencesFor,
  staleReferences,
  type AssetReference,
} from "@/shared/references";
import {
  isTransactionalMedia,
  mediaKind,
  parseMediaLibrary,
  type MediaLibraryId,
} from "@/shared/media";
import type { MediaFile } from "@/shared/types";
import { ErrorBanner } from "@/client/components/error-banner";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { DisclosureChevron } from "@/client/components/disclosure-chevron";
import { IconButton } from "@/client/components/icon-button";
import { MediaLightbox } from "@/client/components/media-lightbox";
import { PageHeader } from "@/client/components/page-header";
import { PathDialog } from "@/client/components/path-dialog";
import {
  FileName,
  FolderCard,
  MediaBreadcrumbs,
  MediaTile,
  MediaTileSkeleton,
  mediaPathTaken,
  NewFolderButton,
  OverwriteDialog,
  UploadButton,
  uploadAccept,
  useMediaUpload,
} from "@/client/components/media-browser";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
} from "@/client/components/ui/item";
import { Toggle } from "@/client/components/ui/toggle";
import { Badge } from "@/client/components/ui/badge";

export const Route = createFileRoute("/media/$library")({
  params: {
    parse: ({ library }): { library: MediaLibraryId } => {
      const id = parseMediaLibrary(config.media, library);

      if (!id) throw notFound();

      return { library: id };
    },
    stringify: ({ library }) => ({ library }),
  },
  validateSearch: (search: Record<string, unknown>): { dir?: string } => {
    const dir = typeof search.dir === "string" ? search.dir : "";

    return dir ? { dir } : {};
  },
  loader: ({ params: { library } }) =>
    Promise.all([preload(mediaQuery(library)), preload(trashQuery(library))]),
  pendingComponent: MediaSkeleton,
  component: MediaRoute,
});

function MediaSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <MediaTileSkeleton key={i} />
      ))}
    </div>
  );
}

/** Keyed by the library, so switching between them starts from a fresh view. */
function MediaRoute() {
  const { library } = Route.useParams();

  return <MediaLibrary key={library} library={library} />;
}

const MiddleDot = () => <span aria-hidden="true"> · </span>;

function MediaLibrary({ library }: { library: MediaLibraryId }) {
  const { t } = useTranslation();
  const run = useRunMutation();
  const refusal = usePathRefusal();
  const navigate = useNavigate({ from: Route.fullPath });
  const { dir = "" } = Route.useSearch();
  const { data: files, error } = useMedia(library);
  const deleteMutation = useDeleteMedia();
  const renameMutation = useRenameMedia();
  const upload = useMediaUpload(library, files);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [lightboxFile, setLightboxFile] = useState<MediaFile | null>(null);
  const [unusedOnly, setUnusedOnly] = useState(false);

  const setDir = (next: string): void => {
    void navigate({ search: next ? { dir: next } : {} });
  };

  const { index, scanning, pending: scanPending, error: scanError, scan } = useReferenceIndex();
  const scanReady = !scanPending && !scanError && !!index;
  const referencesOf = (path: string | null): AssetReference[] =>
    path && index ? referencesFor(index, { library, path }) : [];

  // Every destructive action needs to know what it would break, so opening one
  // asks for the index just as the usage view does.
  const askFor = (setTarget: (path: string) => void, path: string): void => {
    scan();
    setTarget(path);
  };

  // Library-wide, so it survives folder navigation and filter toggles. `used`
  // counts the references of each file that has any.
  const { used, stale, unusedCount } = useMemo(() => {
    const paths = files?.map((file) => file.path) ?? [];
    const used =
      index &&
      new Map(
        index.flatMap((file) =>
          file.library === library ? [[file.path, file.references.length] as const] : [],
        ),
      );

    return {
      used,
      stale: index ? staleReferences(index, library, paths) : [],
      unusedCount: used ? paths.filter((path) => !used.has(path)).length : 0,
    };
  }, [library, files, index]);

  // Everything in this folder, before the unused filter narrows it to what is on screen.
  const { folders, files: dirFiles } = useMemo(
    () => listDirectory(files ?? [], dir, (file) => file.path),
    [files, dir],
  );

  const currentFiles = useMemo(
    () => (unusedOnly && used ? dirFiles.filter((file) => !used.has(file.path)) : dirFiles),
    [dirFiles, unusedOnly, used],
  );

  const usageLabel = (count = 0): string =>
    count === 0 ? t(($) => $.media.unused) : t(($) => $.media.uses, { count });

  const handleDelete = () => {
    if (!deleteTarget || !scanReady) return;

    run(
      deleteMutation,
      { library, path: deleteTarget, acknowledgedReferences: referencesOf(deleteTarget) },
      { success: t(($) => $.media.deleted), onSuccess: () => setDeleteTarget(null) },
    );
  };

  const handleRename = (name: string) => {
    if (!renameTarget || !scanReady) return;

    run(
      renameMutation,
      {
        library,
        from: renameTarget,
        to: join(dirname(renameTarget), name),
        acknowledgedReferences: referencesOf(renameTarget),
      },
      { success: t(($) => $.media.renamed), onSuccess: () => setRenameTarget(null) },
    );
  };

  const validateRename = (name: string): string | null =>
    refusal.media(
      name,
      (value) => !!renameTarget && mediaPathTaken(files, join(dirname(renameTarget), value)),
    );

  if (error) {
    return <ErrorBanner>{t(($) => $.media.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PageHeader
        title={libraryLabel(library)}
        // An object store has no draft branch: what is uploaded or deleted here
        // is live at once, unlike a library in the repository.
        description={!isTransactionalMedia(config.media, library) && t(($) => $.media.immediate)}
        actions={
          <>
            {used && files && scanReady ? (
              <>
                <span className="text-xs text-muted-foreground">
                  {t(($) => $.media.unusedCount, { count: unusedCount, total: files.length })}
                </span>
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={unusedOnly}
                  onPressedChange={setUnusedOnly}
                >
                  {t(($) => $.media.unusedOnly)}
                </Toggle>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled={scanning} onClick={scan}>
                {scanning ? t(($) => $.media.scanningReferences) : t(($) => $.media.checkUsage)}
              </Button>
            )}
            <NewFolderButton dir={dir} files={files} onCreate={setDir} />
            <UploadButton
              accept={uploadAccept(library)}
              status={upload.status}
              onPick={(file) => void upload.add(file, dir)}
            />
          </>
        }
      />

      <div className="mb-3">
        <MediaBreadcrumbs library={library} dir={dir} onNavigate={setDir} />
      </div>

      {stale.length > 0 && (
        <div className="mb-3">
          <ErrorBanner title={t(($) => $.media.staleTitle, { count: stale.length })}>
            <ul className="list-disc pl-5 text-xs">
              {stale.map((reference, i) => (
                <li key={i}>
                  {describeReference(reference)} → <code>{reference.path}</code>
                </li>
              ))}
            </ul>
          </ErrorBanner>
        </div>
      )}

      {scanError && (
        <ErrorBanner>
          {t(($) => $.media.referencesUnavailable, { message: scanError.message })}
        </ErrorBanner>
      )}

      {folders.length === 0 && currentFiles.length === 0 && !scanning && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageOff />
            </EmptyMedia>
            <EmptyTitle>
              {unusedOnly ? t(($) => $.media.noUnused) : t(($) => $.media.noFiles)}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {folders.map(({ name, path }) => (
          <FolderCard key={path} name={name} onOpen={() => setDir(path)} />
        ))}

        {currentFiles.map((file) => (
          <MediaTile
            key={file.path}
            library={library}
            file={file}
            open={
              mediaKind(file.path) === "file"
                ? undefined
                : {
                    label: t(($) => $.media.preview, { name: basename(file.path) }),
                    onClick: () => setLightboxFile(file),
                  }
            }
            actions={
              <>
                <IconButton
                  variant="secondary"
                  label={t(($) => $.common.rename)}
                  onClick={() => askFor(setRenameTarget, file.path)}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  variant="secondary"
                  label={t(($) => $.common.replace)}
                  disabled={upload.status !== "idle"}
                  onClick={() => void upload.replace(file.path)}
                >
                  <Replace />
                </IconButton>
                <IconButton
                  variant="secondary"
                  className="text-destructive"
                  label={t(($) => $.common.delete)}
                  onClick={() => askFor(setDeleteTarget, file.path)}
                >
                  <Trash2 />
                </IconButton>
              </>
            }
          >
            <p className="text-muted-foreground">
              {formatSize(file.size)}
              {used && (
                <>
                  <MiddleDot />
                  {usageLabel(used.get(file.path))}
                </>
              )}
            </p>
          </MediaTile>
        ))}
      </div>

      <TrashPanel library={library} />

      <OverwriteDialog {...upload.overwrite} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t(($) => $.media.deleteFile)}
        description={
          <div className="grid gap-2">
            <p>{t(($) => $.media.deleteFileMessage, { name: basename(deleteTarget ?? "") })}</p>
            <ReferenceWarning
              references={referencesOf(deleteTarget)}
              pending={scanPending}
              error={scanError}
              consequence={t(($) => $.media.deleteReferenced)}
            />
          </div>
        }
        confirmLabel={t(($) => $.common.delete)}
        pendingLabel={t(($) => $.common.deleting)}
        isPending={deleteMutation.isPending}
        variant="destructive"
        disabled={!scanReady}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <PathDialog
        open={renameTarget !== null}
        title={t(($) => $.media.renameFile)}
        description={t(($) => $.media.current, { name: basename(renameTarget ?? "") })}
        initialValue={basename(renameTarget ?? "")}
        confirmLabel={t(($) => $.common.rename)}
        pendingLabel={t(($) => $.common.renaming)}
        isPending={renameMutation.isPending}
        disabled={!scanReady}
        requireChange
        validate={validateRename}
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

      <MediaLightbox library={library} file={lightboxFile} onCancel={() => setLightboxFile(null)} />
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
function TrashPanel({ library }: { library: MediaLibraryId }) {
  const { t } = useTranslation();
  const run = useRunMutation();
  const { data: trashed } = useTrash(library);
  const restore = useRestoreMedia();
  const purge = usePurgeTrash();
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  if (!trashed?.length) return null;

  const target = trashed.find((file) => file.id === purgeTarget);
  const restoringId = restore.isPending ? restore.variables.id : null;

  return (
    <Card className="mt-6 gap-0 py-0">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="group/disclosure w-full justify-between">
            <span className="flex items-center gap-2">
              {t(($) => $.media.trash)}
              <Badge variant="secondary">{trashed.length}</Badge>
            </span>
            <DisclosureChevron />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t p-3">
          <p className="mb-3 text-xs text-muted-foreground">{t(($) => $.media.trashHint)}</p>

          <ItemGroup>
            {trashed.map((file) => (
              <Item key={file.id} variant="outline" size="xs" role="listitem">
                <ItemContent className="min-w-0">
                  <FileName path={file.path} />
                  <ItemDescription>
                    {formatSize(file.size)}
                    <MiddleDot />
                    {t(($) => $.media.deletedAt, {
                      when: new Date(file.deletedAt).toLocaleString(config.locale),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={restore.isPending}
                    onClick={() =>
                      run(
                        restore,
                        { library, id: file.id },
                        { success: t(($) => $.media.restored) },
                      )
                    }
                  >
                    {restoringId === file.id
                      ? t(($) => $.media.restoring)
                      : t(($) => $.media.restore)}
                  </Button>
                  <IconButton
                    className="text-destructive"
                    label={t(($) => $.media.purge)}
                    onClick={() => setPurgeTarget(file.id)}
                  >
                    <Trash2 />
                  </IconButton>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CollapsibleContent>
      </Collapsible>

      <ConfirmDialog
        open={target !== undefined}
        title={t(($) => $.media.purgeTitle)}
        description={t(($) => $.media.purgeMessage, { name: target?.path ?? "" })}
        confirmLabel={t(($) => $.media.purge)}
        pendingLabel={t(($) => $.common.deleting)}
        isPending={purge.isPending}
        variant="destructive"
        onConfirm={() => {
          if (!target) return;

          run(
            purge,
            { library, id: target.id },
            { success: t(($) => $.media.purged), onSuccess: () => setPurgeTarget(null) },
          );
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </Card>
  );
}

/**
 * What content would break, or nothing when no content references the file. A
 * textual match is reported like any other: it is weaker evidence, but the
 * point here is to stop a destructive operation, not to decide what to bundle.
 */
function ReferenceWarning({
  references,
  pending,
  error,
  consequence,
}: {
  references: AssetReference[];
  pending: boolean;
  /** A scan that never produced an answer, which must not read as "nothing references it". */
  error?: Error | null;
  consequence: string;
}) {
  const { t } = useTranslation();

  if (error) return <p>{t(($) => $.media.referencesUnavailable, { message: error.message })}</p>;

  if (pending) return <p>{t(($) => $.media.scanningReferences)}</p>;

  if (references.length === 0) return null;

  return (
    <div>
      <p>
        {t(($) => $.media.usedBy)} {consequence}
      </p>
      <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">
        {references.map((reference, i) => (
          <li key={i}>{describeReference(reference)}</li>
        ))}
      </ul>
    </div>
  );
}
