import { toast as sonnerToast } from "sonner";

export { Toaster } from "@/client/components/ui/sonner";

type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "info") {
  switch (type) {
    case "success":
      sonnerToast.success(message);
      break;
    case "error":
      sonnerToast.error(message);
      break;
    case "info":
      sonnerToast.info(message);
      break;
  }
}
