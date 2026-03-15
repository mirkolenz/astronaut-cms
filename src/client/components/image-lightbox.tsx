import { useDialog } from "@/client/lib/use-dialog";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ open, src, alt = "", onClose }: ImageLightboxProps) {
  const dialogRef = useDialog(open);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="max-h-[90vh] max-w-[90vw] bg-transparent p-0 backdrop:bg-black/80"
    >
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-lg text-white transition-colors hover:bg-black/80"
        >
          &times;
        </button>
        <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" />
      </div>
    </dialog>
  );
}
