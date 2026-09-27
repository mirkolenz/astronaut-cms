import type { LucideIcon } from "lucide-react";

interface EditorCardProps {
  title: string;
  icon?: LucideIcon | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function EditorCard({ title, icon: Icon, actions, children }: EditorCardProps) {
  return (
    <div className="rounded border border-border bg-card">
      <div className="flex items-center gap-1 px-2 py-1">
        {Icon && <Icon className="size-3 text-muted-foreground" />}
        <span className="flex-1 text-xs font-medium">{title}</span>
        {actions}
      </div>
      <div className="space-y-2 border-t border-border p-2">
        {children}
      </div>
    </div>
  );
}
