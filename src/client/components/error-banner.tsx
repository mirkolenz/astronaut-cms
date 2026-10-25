import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/client/components/ui/alert";

interface ErrorBannerProps {
  title?: string;
  /** E.g. a retry button. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function ErrorBanner({ title, action, className, children }: ErrorBannerProps) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
