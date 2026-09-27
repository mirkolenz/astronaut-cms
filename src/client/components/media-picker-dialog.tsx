import { basename } from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMedia } from "@/client/queries/use-media";
import { listDirectory } from "@/client/lib/entry-tree";
import { ErrorBanner } from "@/client/components/error-banner";
import { MediaThumbnail } from "@/client/components/media-thumbnail";
import {
  FolderCard,
  MediaBreadcrumbs,
  NewFolderButton,
  UploadButton,
  uploadAccept,
  useMediaUpload,
} from "@/client/components/media-browser";
import config from "@/client/lib/config";
import { libraryLabel } from "@/client/lib/media";
import {
  mediaKind,
  mediaLibraries,
  type MediaKind,
  type MediaLibraryId,
  type MediaLocation,
} from "@/shared/media";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { ButtonGroup } from "@/client/components/ui/button-group";
import { Toggle } from "@/client/components/ui/toggle";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import { ImageOff } from "lucide-react";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";

interface MediaPickerDialogProps {
  open: boolean;
  /** Offers only files of this kind, every file when unset. */
  kind?: Exclude<MediaKind, "file">;
  /** Offers the repository library alone, for a field only a repository file satisfies. */
  repoOnly?: boolean;
  onSelect: (location: MediaLocation) => void;
  onCancel: () => void;
}

export function MediaPickerDialog({
  open,
  kind,
  repoOnly,
  onSelect,
  onCancel,
}: MediaPickerDialogProps) {
  const { t } = useTranslation();
  const libraries: MediaLibraryId[] = repoOnly ? ["repo"] : mediaLibraries(config.media);
  const [library, setLibrary] = useState<MediaLibraryId>("repo");
  const { data, isLoading } = useMedia(library);
  const [filter, setFilter] = useState("");
  const [dir, setDir] = useState("");
  const upload = useMediaUpload(library, data, (path) => onSelect({ library, path }));

  const pickable = useMemo(
    () => (kind ? data?.filter((file) => mediaKind(file.path) === kind) : data) ?? [],
    [data, kind],
  );

  // A filter searches the whole library, since what it names may sit in any folder.
  const query = filter.trim().toLowerCase();
  const { folders, files } = useMemo(
    () =>
      query
        ? { folders: [], files: pickable.filter((f) => f.path.toLowerCase().includes(query)) }
        : listDirectory(pickable, dir, (file) => file.path),
    [pickable, dir, query],
  );

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

        {libraries.length > 1 && (
          <ButtonGroup>
            {libraries.map((id) => (
              <Toggle
                key={id}
                variant="outline"
                size="sm"
                pressed={id === library}
                onPressedChange={() => {
                  setLibrary(id);
                  setDir("");
                }}
              >
                {libraryLabel(id)}
              </Toggle>
            ))}
          </ButtonGroup>
        )}

        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(($) => $.media.filterPlaceholder)}
            className="flex-1"
          />
          <NewFolderButton dir={dir} onCreate={setDir} />
          <UploadButton state={upload} dir={dir} accept={uploadAccept(library, kind)} />
        </div>

        {!query && <MediaBreadcrumbs library={library} dir={dir} onNavigate={setDir} />}

        {upload.mutation.error && <ErrorBanner>{upload.mutation.error.message}</ErrorBanner>}

        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {isLoading &&
            [1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          {folders.map(({ name, path }) => (
            <FolderCard key={path} name={name} onOpen={() => setDir(path)} className="h-full" />
          ))}
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onSelect({ library, path: file.path })}
              className="group flex flex-col overflow-hidden rounded-md border border-border transition-colors hover:border-ring"
            >
              <div className="flex h-20 items-center justify-center bg-muted">
                <MediaThumbnail library={library} file={file} className="h-full w-full object-contain" />
              </div>
              <div className="border-t border-border px-2 py-1">
                <p className="truncate text-xs text-muted-foreground" title={file.path}>
                  {query ? file.path : basename(file.path)}
                </p>
              </div>
            </button>
          ))}
          {folders.length === 0 && files.length === 0 && !isLoading && (
            <Empty className="col-span-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageOff />
                </EmptyMedia>
                <EmptyTitle>{t(($) => $.media.noFilesFound)}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t(($) => $.common.cancel)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
