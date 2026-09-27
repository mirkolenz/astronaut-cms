import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toLabel } from "@client/lib/to-label";
import { baseName, dirSegments, parentDir } from "@client/lib/entry-tree";

interface BreadcrumbSegment {
  label: string;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

export function Header() {
  const { t } = useTranslation();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { dir?: string };

  const segments: BreadcrumbSegment[] = [{ label: t($ => $.layout.breadcrumbRoot), to: "/" }];
  if (params?.collection) {
    const collection = params.collection;
    segments.push({
      label: toLabel(collection),
      to: "/collections/$collection",
      params: { collection },
      search: { dir: "" },
    });

    // Folder trail: the entry's parent folders when editing an entry, otherwise
    // the directory currently being browsed on the collection index.
    const dir = params.entry ? parentDir(params.entry) : (search?.dir ?? "");
    for (const folder of dirSegments(dir)) {
      segments.push({
        label: folder.name,
        to: "/collections/$collection",
        params: { collection },
        search: { dir: folder.path },
      });
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
    </header>
  );
}
