import type { ReactNode } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { GitCompareArrows, Image, Cloud, Bot } from "lucide-react";
import type { ComponentIcon } from "@/config";
import config from "@/client/lib/config";
import { libraryLabel } from "@/client/lib/media";
import { mediaLibraries, type MediaLibraryId } from "@/shared/media";
import { useChanges } from "@/client/queries/use-entries";
import { collectionIcon, collectionLabel } from "@/client/lib/collections";
import { aiEnabled } from "@/client/lib/ai/config";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/client/components/ui/sidebar";
// `?url` forces a URL string in both the standalone Vite lib build (where assets
// inline as data URIs) and the Astro dev/build runtime, where a bare image import
// would otherwise resolve to an `astro:assets` ImageMetadata object ([object]).
import logoUrl from "@/brand/logo-64.webp?url";

const LIBRARY_ICONS = { repo: Image, s3: Cloud } satisfies Record<MediaLibraryId, ComponentIcon>;

interface NavItemProps {
  to: string;
  params?: Record<string, string>;
  icon: ComponentIcon;
  label: string;
  badge?: ReactNode;
}

/** A link of the sidebar, active anywhere below its route. */
function NavItem({ to, params, icon: Icon, label, badge }: NavItemProps) {
  const { setOpenMobile } = useSidebar();
  const matchRoute = useMatchRoute();

  return (
    <SidebarMenuItem>
      {/* The mobile sheet would otherwise stay open over the page just navigated to. */}
      <SidebarMenuButton
        asChild
        isActive={!!matchRoute({ to, params, fuzzy: true })}
        onClick={() => setOpenMobile(false)}
      >
        <Link to={to} params={params ?? {}}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge}
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { t } = useTranslation();
  const { setOpenMobile } = useSidebar();
  const pending = useChanges().data?.length ?? 0;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" onClick={() => setOpenMobile(false)}>
              <Link to="/" className="text-base font-semibold">
                <img src={logoUrl} alt="" className="size-8" />
                <span>{t(($) => $.layout.appName)}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t(($) => $.layout.collections)}</SidebarGroupLabel>
          <SidebarMenu>
            {Object.keys(config.collections).map((name) => (
              <NavItem
                key={name}
                to="/collections/$collection"
                params={{ collection: name }}
                icon={collectionIcon(name)}
                label={collectionLabel(name)}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t(($) => $.layout.workspace)}</SidebarGroupLabel>
          <SidebarMenu>
            {mediaLibraries(config.media).map((library) => (
              <NavItem
                key={library}
                to="/media/$library"
                params={{ library }}
                icon={LIBRARY_ICONS[library]}
                label={libraryLabel(library)}
              />
            ))}
            <NavItem
              to="/changes"
              icon={GitCompareArrows}
              label={t(($) => $.changes.title)}
              badge={pending > 0 && <SidebarMenuBadge>{pending}</SidebarMenuBadge>}
            />
            {aiEnabled && <NavItem to="/assistant" icon={Bot} label={t(($) => $.ai.title)} />}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
