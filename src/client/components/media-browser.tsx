import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { basename, extname, join } from "pathe";
import { cn } from "cn";
import { useUploadMedia } from "@/client/queries/use-media";
import config from "@/client/lib/config";
import { dirSegments } from "@/client/lib/entry-tree";
import { optimizeImage } from "@/client/lib/image-utils";
import { libraryLabel } from "@/client/lib/media";
import { usePathRefusal } from "@/client/hooks/use-path-refusal";
import { useRunMutation } from "@/client/hooks/use-run-mutation";
import {
  mediaContentType,
  mediaKind,
  mediaLibrary,
  type MediaKind,
  type MediaLibraryId,
} from "@/shared/media";
import type { MediaFile } from "@/shared/types";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/client/components/ui/breadcrumb";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { MediaThumbnail } from "@/client/components/media-thumbnail";
import { PathDialog } from "@/client/components/path-dialog";
import { toast } from "@/client/components/toast";

/**
 * The pieces the media library view and the media picker share: walking the
 * library's folders and files, creating a folder, and uploading into the one that is open.
 */

export function MediaBreadcrumbs({
  library,
  dir,
  onNavigate,
}: {
  library: MediaLibraryId;
  dir: string;
  onNavigate: (dir: string) => void;
}) {
  const segments = dirSegments(dir);

  if (segments.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <button type="button" onClick={() => onNavigate("")}>
              {libraryLabel(library)}
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {segments.map(({ name, path }, i) => (
          <Fragment key={path}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {i === segments.length - 1 ? (
                <BreadcrumbPage>{name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={() => onNavigate(path)}>
                    {name}
                  </button>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** A folder in a grid of files, as tall as their cards in a grid of equal rows. */
export function FolderCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      className="flex h-full flex-col items-center justify-center gap-2 hover:border-accent-foreground/30 hover:bg-accent"
    >
      <Folder className="size-8 text-muted-foreground" />
      <span className="truncate text-sm font-medium text-foreground">{name}</span>
    </Button>
  );
}

/** A file name cut to its card's width, with the full path on hover. */
export function FileName({ path, label = path }: { path: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className="truncate font-medium">{label}</p>
      </TooltipTrigger>
      <TooltipContent>{path}</TooltipContent>
    </Tooltip>
  );
}

const PREVIEW = "flex h-28 items-center justify-center bg-muted";

/** A file in a grid of files: its thumbnail, then its name and `children` below. */
export function MediaTile({
  library,
  file,
  label = basename(file.path),
  open,
  actions,
  className,
  children,
}: {
  library: MediaLibraryId;
  file: MediaFile;
  /** The name shown, the full path shows on hover. */
  label?: string;
  /** Makes the thumbnail a button, such as one that previews or picks the file. */
  open?: { label: string; onClick: () => void };
  /** Shown over the thumbnail while the tile is hovered or focused. */
  actions?: ReactNode;
  /** Sizes the thumbnail. */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="group relative gap-0 py-0">
      {open ? (
        <Button
          type="button"
          variant="ghost"
          onClick={open.onClick}
          aria-label={open.label}
          className={cn(PREVIEW, "w-full cursor-pointer rounded-none", className)}
        >
          <MediaThumbnail library={library} file={file} className="h-full w-full object-contain" />
        </Button>
      ) : (
        <div className={cn(PREVIEW, className)}>
          <MediaThumbnail library={library} file={file} />
        </div>
      )}
      {actions && (
        <div className="absolute right-1 top-1 hidden gap-1 group-focus-within:flex group-hover:flex">
          {actions}
        </div>
      )}
      <CardContent className="border-t px-3 py-2 text-xs">
        <FileName path={file.path} label={label} />
        {children}
      </CardContent>
    </Card>
  );
}

/** Shaped like a {@link MediaTile}, so the grid keeps its height once the files arrive. */
export function MediaTileSkeleton({ className }: { className?: string }) {
  return (
    <Card className="gap-0 py-0">
      <Skeleton className={cn("h-28 rounded-none", className)} />
      <CardContent className="space-y-1 border-t px-3 py-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </CardContent>
    </Card>
  );
}

/** Whether a library path is already a file or a folder holding files. */
export function mediaPathTaken(files: MediaFile[] | undefined, path: string): boolean {
  return !!files?.some((file) => file.path === path || file.path.startsWith(`${path}/`));
}

/**
 * Opens a folder that need not exist yet. Neither a repository nor an object
 * store holds an empty directory, so the folder is only a place to upload into
 * and exists once the first file lands in it.
 */
export function NewFolderButton({
  dir,
  files,
  onCreate,
}: {
  dir: string;
  files: MediaFile[] | undefined;
  onCreate: (dir: string) => void;
}) {
  const { t } = useTranslation();
  const refusal = usePathRefusal();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(($) => $.media.newFolder)}
      </Button>
      <PathDialog
        open={open}
        title={t(($) => $.media.newFolder)}
        confirmLabel={t(($) => $.common.create)}
        validate={(name) => refusal.media(name, (value) => mediaPathTaken(files, join(dir, value)))}
        onSubmit={(name) => {
          onCreate(join(dir, name));
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** Asks the browser for one file, without a file input in the page. */
function pickFile(accept?: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");

    input.type = "file";

    if (accept) input.accept = accept;

    input.addEventListener("change", () => resolve(input.files?.[0]));
    input.click();
  });
}

type UploadStatus = "idle" | "optimizing" | "uploading";

/** A file about to land on a path that already holds one, which waits for confirmation. */
interface PendingWrite {
  path: string;
  file: File;
  /** Picked to replace that file, rather than uploaded under its own name. */
  replacing: boolean;
}

/**
 * An upload into a folder of one library, asking before it replaces a file of
 * the same name. The name is checked against the full library path it would land
 * at, so a file of the same name in another folder is neither mistaken for it
 * nor replaced. The image is optimized as that library says, which is what its
 * size bounds are then checked against.
 */
export function useMediaUpload(
  library: MediaLibraryId,
  files: MediaFile[] | undefined,
  onUploaded?: (path: string) => void,
) {
  const { t } = useTranslation();
  const run = useRunMutation();
  const mutation = useUploadMedia();
  const [optimizing, setOptimizing] = useState(false);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const settings = mediaLibrary(config.media, library).imageOptimization;

  // A replacement keeps its format, since references address it by its path and extension.
  const optimize = async (file: File, keepFormat: boolean): Promise<File | null> => {
    setOptimizing(true);

    try {
      return await optimizeImage(
        file,
        settings && keepFormat ? { ...settings, format: null } : settings,
      );
    } catch {
      toast(
        t(($) => $.media.optimizeFailed, { name: file.name }),
        "error",
      );

      return null;
    } finally {
      setOptimizing(false);
    }
  };

  const send = (write: PendingWrite, overwrite: boolean): void => {
    run(
      mutation,
      { library, path: write.path, file: write.file, overwrite },
      {
        success: write.replacing ? t(($) => $.media.replaced) : t(($) => $.media.uploaded),
        onSuccess: () => {
          setPending(null);
          onUploaded?.(write.path);
        },
      },
    );
  };

  const add = async (raw: File, dir: string): Promise<void> => {
    const file = await optimize(raw, false);

    if (!file) return;

    const write = { path: join(dir, file.name), file, replacing: false };

    if (files?.some((f) => f.path === write.path)) setPending(write);
    else send(write, false);
  };

  const replace = async (path: string): Promise<void> => {
    const raw = await pickFile(extname(path));

    if (!raw) return;

    if (mediaContentType(raw.name) !== mediaContentType(path)) {
      toast(
        t(($) => $.media.replaceType, { name: basename(path) }),
        "error",
      );

      return;
    }

    const file = await optimize(raw, true);

    if (file) setPending({ path, file, replacing: true });
  };

  const status: UploadStatus = optimizing
    ? "optimizing"
    : mutation.isPending
      ? "uploading"
      : "idle";

  return {
    status,
    /** Uploads a file into `dir` under its own name. */
    add,
    /** Picks a file of the same type to put in place of the one at `path`. */
    replace,
    /** The props of the {@link OverwriteDialog} that confirms a write over an existing file. */
    overwrite: {
      write: pending,
      isPending: mutation.isPending,
      onConfirm: () => {
        if (pending) send(pending, true);
      },
      onCancel: () => setPending(null),
    },
  };
}

/** Confirms a write over an existing file, from {@link useMediaUpload}. */
export function OverwriteDialog({
  write,
  isPending,
  onConfirm,
  onCancel,
}: {
  write: PendingWrite | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const name = write ? basename(write.path) : "";

  return (
    <ConfirmDialog
      open={write !== null}
      title={write?.replacing ? t(($) => $.media.replaceFile) : t(($) => $.media.fileExists)}
      description={
        write?.replacing
          ? t(($) => $.media.replaceFileMessage, { name, file: write.file.name })
          : t(($) => $.media.fileExistsMessage, { name })
      }
      confirmLabel={write?.replacing ? t(($) => $.common.replace) : t(($) => $.common.overwrite)}
      pendingLabel={t(($) => $.common.uploading)}
      isPending={isPending}
      variant="destructive"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * What an upload control offers to pick: the library's own extensions where it
 * restricts them, narrowed to `kind` when one is asked for.
 */
export function uploadAccept(
  library: MediaLibraryId,
  kind?: Exclude<MediaKind, "file">,
): string | undefined {
  const extensions = mediaLibrary(config.media, library).extensions;

  if (!extensions) return kind && `${kind}/*`;

  const offered = kind ? extensions.filter((ext) => mediaKind(ext) === kind) : extensions;

  return offered.join(",") || undefined;
}

/** The upload control of {@link useMediaUpload}. */
export function UploadButton({
  accept,
  status,
  onPick,
}: {
  accept?: string;
  status: UploadStatus;
  onPick: (file: File) => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      disabled={status !== "idle"}
      onClick={() => {
        void pickFile(accept).then((file) => {
          if (file) onPick(file);
        });
      }}
    >
      {status === "optimizing"
        ? t(($) => $.common.optimizing)
        : status === "uploading"
          ? t(($) => $.common.uploading)
          : t(($) => $.common.upload)}
    </Button>
  );
}
