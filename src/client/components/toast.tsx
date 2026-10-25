import { toast as sonnerToast } from "sonner";

export { Toaster } from "@/client/components/ui/sonner";

export function toast(message: string, type: "success" | "error" | "info" = "info") {
  sonnerToast[type](message);
}
