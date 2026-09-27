import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileText, NotebookPen, BarChart3, Image } from "lucide-react";
import { useCollections } from "@client/queries/use-collections";
import { toLabel } from "@client/lib/to-label";
import logoUrl from "@assets/logo.png";

const navLinkClasses =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent [&.active]:bg-sidebar-accent [&.active]:font-medium";

export function Sidebar() {
  const { t } = useTranslation();
  const { data: collections, isLoading } = useCollections();

  return (
    <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar">
      <div className="p-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-lg font-semibold text-sidebar-foreground"
        >
          <img src={logoUrl} alt="" className="size-8 shrink-0" />
          {t($ => $.layout.appName)}
        </Link>
      </div>
      <nav className="px-2 pb-4">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t($ => $.layout.collections)}
        </p>
        {isLoading && (
          <div className="space-y-1 px-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
        {collections &&
          Object.entries(collections).map(([name, col]) => (
            <Link
              key={name}
              to="/collections/$collection"
              params={{ collection: name }}
              className={navLinkClasses}
            >
              {col.loaderType === "file"
                ? <FileText className="size-4 text-muted-foreground" />
                : col.type === "content"
                  ? <NotebookPen className="size-4 text-muted-foreground" />
                  : <BarChart3 className="size-4 text-muted-foreground" />}
              {toLabel(name)}
            </Link>
          ))}
        <p className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t($ => $.layout.assets)}
        </p>
        <Link to="/media" className={navLinkClasses}>
          <Image className="size-4 text-muted-foreground" />
          {t($ => $.layout.media)}
        </Link>
      </nav>
    </aside>
  );
}
