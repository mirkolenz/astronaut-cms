import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Rendered below the description, e.g. a locale switcher. */
  children?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, children, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        {children && <div className="mt-1.5">{children}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
