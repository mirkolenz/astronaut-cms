import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileText, NotebookPen, BarChart3, Image } from "lucide-react";
import { useCollections } from "@/client/queries/use-collections";
import { toLabel } from "@/client/lib/to-label";

const navLinkClasses =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800 [&.active]:bg-gray-200 [&.active]:font-medium dark:[&.active]:bg-gray-800";

export function Sidebar() {
  const { t } = useTranslation();
  const { data: collections, isLoading } = useCollections();

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <div className="p-4">
        <Link to="/" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t($ => $.layout.appName)}
        </Link>
      </div>
      <nav className="px-2 pb-4">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
          {t($ => $.layout.collections)}
        </p>
        {isLoading && (
          <div className="space-y-1 px-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
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
                ? <FileText className="size-4 text-gray-400" />
                : col.type === "content"
                  ? <NotebookPen className="size-4 text-gray-400" />
                  : <BarChart3 className="size-4 text-gray-400" />}
              {toLabel(name)}
            </Link>
          ))}
        <p className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
          {t($ => $.layout.assets)}
        </p>
        <Link to="/media" className={navLinkClasses}>
          <Image className="size-4 text-gray-400" />
          {t($ => $.layout.media)}
        </Link>
      </nav>
    </aside>
  );
}
