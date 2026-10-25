import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { GitCompareArrows, Image, Cloud, Bot } from "lucide-react";
import config from "@/client/lib/config";
import { libraryLabel } from "@/client/lib/media";
import { mediaLibraries, type MediaLibraryId } from "@/shared/media";
import { useChanges } from "@/client/queries/use-entries";
import { Badge } from "@/client/components/ui/badge";
import { collectionIcon, collectionLabel } from "@/client/lib/collections";
import { aiEnabled } from "@/client/lib/ai/config";
// `?url` forces a URL string in both the standalone Vite lib build (where assets
// inline as data URIs) and the Astro dev/build runtime, where a bare image import
// would otherwise resolve to an `astro:assets` ImageMetadata object ([object]).
import logoUrl from "@/brand/logo-64.webp?url";

const LIBRARY_ICONS = { repo: Image, s3: Cloud } satisfies Record<MediaLibraryId, unknown>;

const navLinkClasses =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent [&.active]:bg-sidebar-accent [&.active]:font-medium";

export function Sidebar() {
  const { t } = useTranslation();
  const { collections } = config;
  const pending = useChanges().data?.length ?? 0;

  return (
    <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar">
      <div className="p-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-lg font-semibold text-sidebar-foreground"
        >
          <img src={logoUrl} alt="" className="size-8 shrink-0" />
          {t(($) => $.layout.appName)}
        </Link>
      </div>
      <nav className="px-2 pb-4">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t(($) => $.layout.collections)}
        </p>
        {Object.keys(collections).map((name) => {
          const Icon = collectionIcon(name);

          return (
            <Link
              key={name}
              to="/collections/$collection"
              params={{ collection: name }}
              className={navLinkClasses}
            >
              <Icon className="size-4 text-muted-foreground" />
              {collectionLabel(name)}
            </Link>
          );
        })}
        <p className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t(($) => $.layout.workspace)}
        </p>
        {mediaLibraries(config.media).map((library) => {
          const Icon = LIBRARY_ICONS[library];

          return (
            <Link key={library} to="/media/$library" params={{ library }} className={navLinkClasses}>
              <Icon className="size-4 text-muted-foreground" />
              {libraryLabel(library)}
            </Link>
          );
        })}
        <Link to="/changes" className={navLinkClasses}>
          <GitCompareArrows className="size-4 text-muted-foreground" />
          {t(($) => $.changes.title)}
          {pending > 0 && <Badge className="ml-auto">{pending}</Badge>}
        </Link>
        {aiEnabled && (
          <Link to="/assistant" className={navLinkClasses}>
            <Bot className="size-4 text-muted-foreground" />
            {t(($) => $.ai.title)}
          </Link>
        )}
      </nav>
    </aside>
  );
}
