import { X } from "lucide-react";
import { Dialog, DialogContent } from "@/client/components/ui/dialog";
import { mediaUrl } from "@/client/lib/media";
import { mediaKind } from "@/shared/media";
import type { MediaFile } from "@/shared/types";

interface MediaLightboxProps {
  file: MediaFile | null;
  onClose: () => void;
}

/** A library image, video or audio file at full size, playable where it plays. */
export function MediaLightbox({ file, onClose }: MediaLightboxProps) {
  return (
    <Dialog
      open={file !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="border-none bg-transparent p-0 ring-0 shadow-none sm:max-w-[90vw]"
      >
        <div className="relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="size-4" />
          </button>
          {file && <Preview file={file} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ file }: { file: MediaFile }) {
  const src = mediaUrl(file.path, file.version);

  switch (mediaKind(file.path)) {
    case "video":
      return <video src={src} controls autoPlay className="max-h-[90vh] max-w-[90vw]" />;
    case "audio":
      return <audio src={src} controls autoPlay className="w-[min(32rem,90vw)]" />;
    default:
      return <img src={src} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />;
  }
}
