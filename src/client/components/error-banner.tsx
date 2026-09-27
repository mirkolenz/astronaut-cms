import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@client/components/ui/alert";

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
