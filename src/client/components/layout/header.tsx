import { Fragment } from "react";
import { Link, useMatches, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { collectionLabel, isSingleton } from "@/client/lib/collections";
import { basename } from "pathe";
import { dirSegments, parentDir } from "@/client/lib/entry-tree";
import { joinLocale, splitLocale } from "@/shared/i18n";
import { useEntries } from "@/client/queries/use-entries";
import { useCollectionI18n } from "@/client/lib/content-i18n";
import { Scale } from "lucide-react";
import { fileUrl } from "@/client/lib/routes";
import { libraryLabel } from "@/client/lib/media";
import { LICENSES_PATH } from "@/shared/auth";
import { UiLocaleMenu } from "@/client/components/layout/ui-locale-menu";
import { IconButton, LabelTooltip } from "@/client/components/icon-button";
import { Separator } from "@/client/components/ui/separator";
import { SidebarTrigger } from "@/client/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/client/components/ui/breadcrumb";

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
  const routeId = useMatches({ select: (matches) => matches.at(-1)?.routeId });
  const i18n = useCollectionI18n(useEntries(collection ?? "").data);

  const segments: BreadcrumbSegment[] = [{ label: t(($) => $.layout.breadcrumbRoot), to: "/" }];

  if (routeId === "/changes") {
    segments.push({ label: t(($) => $.changes.title) });
  } else if (routeId === "/assistant") {
    segments.push({ label: t(($) => $.ai.title) });
  } else if (params.library) {
    segments.push({ label: libraryLabel(params.library) });
  } else if (collection && isSingleton(collection)) {
    // A singleton's one entry is the collection, so there is no listing to link to.
    segments.push({ label: collectionLabel(collection) });
  } else if (collection) {
    // Folder trail: the entry's parent folders when editing an entry, otherwise
    // the directory currently being browsed on the collection index. Its leading
    // segment is the language, which the collection page shows as tabs rather
    // than a folder, so it is dropped here but kept in every link, otherwise
    // going up would silently land in the default language.
    const dir = params.entry ? parentDir(params.entry) : (search.dir ?? "");
    const { locale, slug } = splitLocale(dir, i18n?.locales ?? []);
    const dirLink = (path: string) => ({
      to: "/collections/$collection",
      params: { collection },
      search: { dir: locale ? joinLocale(locale, path) : path },
    });

    segments.push({ label: collectionLabel(collection), ...dirLink("") });

    for (const folder of dirSegments(slug)) {
      segments.push({ label: folder.name, ...dirLink(folder.path) });
    }

    if (params.entry) {
      segments.push({ label: basename(params.entry) });
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <LabelTooltip label={t(($) => $.layout.toggleSidebar)} shortcut={["mod", "B"]}>
        <SidebarTrigger aria-label={t(($) => $.layout.toggleSidebar)} />
      </LabelTooltip>
      <Separator orientation="vertical" className="data-vertical:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {segments.map((seg, i) => (
            <Fragment key={`${seg.to ?? ""}-${seg.search?.dir ?? ""}-${seg.label}`}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {i < segments.length - 1 && seg.to ? (
                  <BreadcrumbLink asChild>
                    <Link to={seg.to} params={seg.params ?? {}} search={seg.search ?? {}}>
                      {seg.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{seg.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center">
        <IconButton asChild size="icon-sm" label={t(($) => $.layout.licenses)}>
          <a href={fileUrl(LICENSES_PATH)} target="_blank" rel="noopener noreferrer">
            <Scale />
          </a>
        </IconButton>
        <UiLocaleMenu />
      </div>
    </header>
  );
}
