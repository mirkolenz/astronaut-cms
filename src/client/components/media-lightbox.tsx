import { useTranslation } from "react-i18next";
import { basename } from "pathe";
import { Dialog, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { mediaUrl } from "@/client/lib/media";
import { mediaKind, type MediaLibraryId } from "@/shared/media";
import type { MediaFile } from "@/shared/types";

interface MediaLightboxProps {
  library: MediaLibraryId;
  file: MediaFile | null;
  onCancel: () => void;
}

/** A library image, video or audio file at full size, playable where it plays. */
export function MediaLightbox({ library, file, onCancel }: MediaLightboxProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      {/* As wide as the file itself, so it is centered and a click beside it closes. */}
      <DialogContent className="w-fit border-none bg-transparent p-0 ring-0 shadow-none sm:max-w-[90vw]">
        {file && (
          <>
            <DialogTitle className="sr-only">
              {t(($) => $.media.preview, { name: basename(file.path) })}
            </DialogTitle>
            <Preview library={library} file={file} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Preview({ library, file }: { library: MediaLibraryId; file: MediaFile }) {
  const src = mediaUrl({ library, path: file.path }, file.version);

  switch (mediaKind(file.path)) {
    case "video":
      return <video src={src} controls autoPlay className="max-h-[90vh] max-w-[90vw]" />;
    case "audio":
      return <audio src={src} controls autoPlay className="w-[min(32rem,90vw)]" />;
    default:
      return <img src={src} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />;
  }
}
