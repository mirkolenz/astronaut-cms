import { useState } from "react";
import { useTranslation } from "react-i18next";
import { basename, join } from "pathe";
import { useUploadMedia } from "@/client/queries/use-media";
import { dirSegments } from "@/client/lib/entry-tree";
import { optimizeImage } from "@/client/lib/image-utils";
import { cn } from "@/client/lib/utils";
import { validateMediaPath } from "@/shared/validation";
import type { MediaFile } from "@/shared/types";
import { Button } from "@/client/components/ui/button";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { PathDialog, refusal } from "@/client/components/path-dialog";

/**
 * The pieces the media library view and the media picker share: walking the
 * library's folders, creating one, and uploading into the one that is open.
 */

export function MediaBreadcrumbs({
  dir,
  onNavigate,
}: {
  dir: string;
  onNavigate: (dir: string) => void;
}) {
  const { t } = useTranslation();
  const segments = dirSegments(dir);

  if (segments.length === 0) return null;

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <Button type="button" variant="link" size="xs" onClick={() => onNavigate("")}>
        {t(($) => $.media.title)}
      </Button>
      {segments.map(({ name, path }, i) => (
        <span key={path} className="flex items-center gap-1">
          <span>/</span>
          {i === segments.length - 1 ? (
            <span className="font-medium text-foreground">{name}</span>
          ) : (
            <Button type="button" variant="link" size="xs" onClick={() => onNavigate(path)}>
              {name}
            </Button>
          )}
        </span>
      ))}
    </nav>
  );
}

export function FolderCard({
  name,
  onOpen,
  className,
}: {
  name: string;
  onOpen: () => void;
  className: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      className={cn(
        "flex flex-col items-center justify-center gap-2 hover:border-accent-foreground/30 hover:bg-accent",
        className,
      )}
    >
      <span className="text-3xl text-muted-foreground">&#128193;</span>
      <span className="truncate text-sm font-medium text-foreground">{name}</span>
    </Button>
  );
}

/**
 * Opens a folder that need not exist yet. Neither a repository nor an object
 * store holds an empty directory, so the folder is only a place to upload into
 * and exists once the first file lands in it.
 */
export function NewFolderButton({ dir, onCreate }: { dir: string; onCreate: (dir: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(($) => $.media.newFolder)}
      </Button>
      {open && (
        <PathDialog
          title={t(($) => $.media.newFolder)}
          initial=""
          confirmLabel={t(($) => $.common.create)}
          validate={mediaPathRefusal}
          onSubmit={(name) => {
            onCreate(join(dir, name));
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Why a name is refused as a library path, which may nest ("2026/summer"). */
export const mediaPathRefusal = (path: string): string | null => refusal(validateMediaPath, path);

/**
 * An upload into a folder, asking before it replaces a file of the same name.
 * The name is checked against the full library path it would land at, so a file
 * of the same name in another folder is neither mistaken for it nor replaced.
 */
export function useMediaUpload(files: MediaFile[] | undefined, onUploaded?: (path: string) => void) {
  const mutation = useUploadMedia();
  const [optimizing, setOptimizing] = useState(false);
  const [duplicate, setDuplicate] = useState<{ path: string; file: File } | null>(null);

  // A refused upload (the size limit, say) surfaces as `mutation.error` rather
  // than as an unhandled rejection.
  const send = (path: string, file: File, overwrite?: boolean): void => {
    mutation.mutateAsync({ path, file, overwrite }).then(
      () => onUploaded?.(path),
      () => {},
    );
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>, dir: string): Promise<void> => {
    const raw = e.target.files?.[0];

    e.target.value = "";

    if (!raw) return;

    setOptimizing(true);

    const file = await optimizeImage(raw).finally(() => setOptimizing(false));
    const path = join(dir, file.name);

    if (files?.some((f) => f.path === path)) {
      setDuplicate({ path, file });

      return;
    }

    send(path, file);
  };

  const overwrite = (): void => {
    if (!duplicate) return;

    send(duplicate.path, duplicate.file, true);
    setDuplicate(null);
  };

  return {
    upload,
    overwrite,
    duplicate,
    dismiss: () => setDuplicate(null),
    optimizing,
    mutation,
  };
}

/** The upload control of {@link useMediaUpload}, with its overwrite prompt. */
export function UploadButton({
  state,
  dir,
  accept,
}: {
  state: ReturnType<typeof useMediaUpload>;
  dir: string;
  accept?: string;
}) {
  const { t } = useTranslation();
  const { upload, overwrite, duplicate, dismiss, optimizing, mutation } = state;

  return (
    <>
      <Button asChild>
        <label className="cursor-pointer">
          {optimizing
            ? t(($) => $.common.optimizing)
            : mutation.isPending
              ? t(($) => $.common.uploading)
              : t(($) => $.common.upload)}
          <input
            type="file"
            accept={accept}
            onChange={(e) => void upload(e, dir)}
            className="hidden"
            disabled={mutation.isPending || optimizing}
          />
        </label>
      </Button>
      <ConfirmDialog
        open={duplicate !== null}
        title={t(($) => $.media.fileExists)}
        message={t(($) => $.media.fileExistsMessage, {
          name: duplicate ? basename(duplicate.path) : "",
        })}
        confirmLabel={t(($) => $.common.overwrite)}
        variant="danger"
        onConfirm={overwrite}
        onCancel={dismiss}
      />
    </>
  );
}
