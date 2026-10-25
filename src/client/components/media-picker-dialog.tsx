import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import { useMedia } from "@/client/queries/use-media";
import { listDirectory } from "@/client/lib/entry-tree";
import { ErrorBanner } from "@/client/components/error-banner";
import { FormDialog } from "@/client/components/form-dialog";
import {
  FolderCard,
  MediaBreadcrumbs,
  MediaTile,
  MediaTileSkeleton,
  NewFolderButton,
  OverwriteDialog,
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
import { DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/client/components/ui/toggle-group";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import { Input } from "@/client/components/ui/input";

interface MediaPickerDialogProps {
  open: boolean;
  /** Offers only files of this kind, every file when unset. */
  kind?: Exclude<MediaKind, "file">;
  /** Offers the repository library alone, for a field only a repository file satisfies. */
  repoOnly?: boolean;
  onSelect: (location: MediaLocation) => void;
  onCancel: () => void;
}

/** Picks a library file. Its state mounts only while open, so every opening starts at the top. */
export function MediaPickerDialog({ open, ...props }: MediaPickerDialogProps) {
  return (
    <FormDialog open={open} onCancel={props.onCancel} className="sm:max-w-3xl">
      <MediaPicker {...props} />
    </FormDialog>
  );
}

function MediaPicker({ kind, repoOnly, onSelect, onCancel }: Omit<MediaPickerDialogProps, "open">) {
  const { t } = useTranslation();
  const libraries: MediaLibraryId[] = repoOnly ? ["repo"] : mediaLibraries(config.media);
  const [library, setLibrary] = useState<MediaLibraryId>("repo");
  const { data, isLoading, error } = useMedia(library);
  const [filter, setFilter] = useState("");
  const [dir, setDir] = useState("");
  // A fresh upload is picked at once, unless it is not of the kind asked for.
  const upload = useMediaUpload(library, data, (path) => {
    if (!kind || mediaKind(path) === kind) onSelect({ library, path });
  });

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
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $.media.selectMedia)}</DialogTitle>
      </DialogHeader>

      {libraries.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={library}
          onValueChange={(value) => {
            const picked = libraries.find((id) => id === value);

            if (!picked) return;

            setLibrary(picked);
            setDir("");
            setFilter("");
          }}
        >
          {libraries.map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {libraryLabel(id)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t(($) => $.media.filterPlaceholder)}
          aria-label={t(($) => $.media.filterPlaceholder)}
          className="flex-1"
        />
        <NewFolderButton dir={dir} files={data} onCreate={setDir} />
        <UploadButton
          accept={uploadAccept(library, kind)}
          status={upload.status}
          onPick={(file) => void upload.add(file, dir)}
        />
      </div>

      {!query && <MediaBreadcrumbs library={library} dir={dir} onNavigate={setDir} />}

      {error ? (
        <ErrorBanner>{t(($) => $.media.failedLoad, { message: error.message })}</ErrorBanner>
      ) : (
        <div className="grid max-h-[60vh] auto-rows-fr grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {isLoading && [1, 2, 3, 4].map((i) => <MediaTileSkeleton key={i} className="h-20" />)}
          {folders.map(({ name, path }) => (
            <FolderCard key={path} name={name} onOpen={() => setDir(path)} />
          ))}
          {files.map((file) => (
            <MediaTile
              key={file.path}
              library={library}
              file={file}
              label={query ? file.path : undefined}
              open={{ label: file.path, onClick: () => onSelect({ library, path: file.path }) }}
              className="h-20"
            />
          ))}
          {data && folders.length === 0 && files.length === 0 && (
            <Empty className="col-span-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageOff />
                </EmptyMedia>
                <EmptyTitle>{t(($) => $.media.noFiles)}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t(($) => $.common.cancel)}
        </Button>
      </DialogFooter>

      <OverwriteDialog {...upload.overwrite} />
    </>
  );
}
