import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toLabel } from "@/client/lib/to-label";
import { baseName, dirSegments, parentDir } from "@/client/lib/entry-tree";
import { joinLocale, splitLocale } from "@/shared/i18n";
import { useEntries } from "@/client/queries/use-entries";
import { useCollectionI18n } from "@/client/lib/content-i18n";
import { UiLocaleMenu } from "@/client/components/layout/ui-locale-menu";

interface BreadcrumbSegment {
  label: string;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

export function Header() {
  const { t } = useTranslation();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const collection = params?.collection;
  const i18n = useCollectionI18n(useEntries(collection ?? "").data);

  const segments: BreadcrumbSegment[] = [{ label: t(($) => $.layout.breadcrumbRoot), to: "/" }];
  if (collection) {
    // Folder trail: the entry's parent folders when editing an entry, otherwise
    // the directory currently being browsed on the collection index. Its leading
    // segment is the language, which the collection page shows as tabs rather
    // than a folder — so it is dropped here but kept in every link, otherwise
    // going up would silently land in the default language.
    const dir = params.entry ? parentDir(params.entry) : (search.dir ?? "");
    const { locale, slug } = splitLocale(dir, i18n?.locales ?? []);
    const dirLink = (path: string) => ({
      to: "/collections/$collection",
      params: { collection },
      search: { dir: locale ? joinLocale(locale, path) : path },
    });

    segments.push({ label: toLabel(collection), ...dirLink("") });

    for (const folder of dirSegments(slug)) {
      segments.push({ label: folder.name, ...dirLink(folder.path) });
    }

    if (params.entry) {
      segments.push({ label: baseName(params.entry) });
    }
  }

  return (
    <header className="flex h-12 items-center border-b border-border px-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {segments.map((seg, i) => (
          <span
            key={`${seg.to ?? ""}-${seg.search?.dir ?? ""}-${seg.label}`}
            className="flex items-center gap-1.5"
          >
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            {i < segments.length - 1 && seg.to ? (
              <Link
                to={seg.to}
                params={seg.params ?? {}}
                search={seg.search ?? {}}
                className="hover:text-foreground"
              >
                {seg.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{seg.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="ml-auto">
        <UiLocaleMenu />
      </div>
    </header>
  );
}
