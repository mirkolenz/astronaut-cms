import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toLabel } from "@/client/lib/to-label";

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
    <header className="flex h-12 items-center border-b border-gray-200 px-6 dark:border-gray-700">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        {segments.map((seg, i) => (
          <span key={seg.to ?? seg.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300 dark:text-gray-600">/</span>}
            {i < segments.length - 1 && seg.to ? (
              <Link
                to={seg.to}
                params={seg.params ?? {}}
                className="hover:text-gray-900 dark:hover:text-gray-100"
              >
                {seg.label}
              </Link>
            ) : (
              <span className="font-medium text-gray-900 dark:text-gray-100">{seg.label}</span>
            )}
          </span>
        ))}
      </nav>
    </header>
  );
}
