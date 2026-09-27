import { X } from "lucide-react";
import { Dialog, DialogContent } from "@/client/components/ui/dialog";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ open, src, alt = "", onClose }: ImageLightboxProps) {
  return (
    <Dialog
      open={open}
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
            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="size-4" />
          </button>
          <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
