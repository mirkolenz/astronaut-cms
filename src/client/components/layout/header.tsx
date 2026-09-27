import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toLabel } from "@client/lib/to-label";

export function Header() {
  const { t } = useTranslation();
  const params = useParams({ strict: false });

  const segments: { label: string; to?: string; params?: Record<string, string> }[] = [
    { label: t($ => $.layout.breadcrumbRoot), to: "/" },
  ];
  if (params?.collection) {
    segments.push({
      label: toLabel(params.collection),
      to: "/collections/$collection",
      params: { collection: params.collection },
    });
  }
  if (params?.entry) {
    segments.push({ label: params.entry });
  }

  return (
    <header className="flex h-12 items-center border-b border-border px-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {segments.map((seg, i) => (
          <span key={seg.to ?? seg.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            {i < segments.length - 1 && seg.to ? (
              <Link
                to={seg.to}
                params={seg.params ?? {}}
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
