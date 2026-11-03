import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Star } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { SanadiLogo } from "@/components/SanadiLogo";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { GROUP_TARGET, visibleNav, type NavGroup, type NavLink } from "@/lib/nav";
import { useFavorites, useNavBadges, type BadgeCounts } from "@/lib/nav-state";
import { cn } from "@/lib/utils";

function isCurrent(
  link: { to: string; search?: Record<string, string> },
  pathname: string,
  search: Record<string, unknown>,
) {
  if (link.to !== pathname) return false;
  const keys = Object.keys(link.search ?? {});
  if (keys.length === 0) return true;
  return keys.every((k) => String(search[k] ?? "") === link.search![k]);
}

export function AppSidebar() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const groups = visibleNav(roles);
  const { codes: favorites, toggle } = useFavorites();
  const { data: badges } = useNavBadges(roles.length > 0);

  const favoriteLinks = groups.flatMap((g) => g.items).filter((i) => favorites.includes(i.code));

  return (
    <Sidebar collapsible="icon" side={ar ? "right" : "left"}>
      <SidebarHeader className={collapsed ? "items-center" : undefined}>
        <Link
          to="/"
          aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
          className={cn(
            "flex min-w-0 items-center rounded-md font-semibold tracking-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed
              ? "size-8 justify-start overflow-hidden p-0"
              : "w-full overflow-hidden px-1 py-1.5",
          )}
        >
          <SanadiLogo
            withName={!collapsed}
            compactOnly={collapsed}
            className={cn(
              "shrink-0 justify-start overflow-hidden",
              collapsed
                ? "size-8 [&>img]:!h-[1.125rem] [&>img]:!w-auto [&>img]:!max-w-none"
                : "w-full [&>img]:!h-auto [&>img]:!max-h-12 [&>img]:!w-auto [&>img]:!max-w-full",
            )}
          />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {favoriteLinks.length > 0 && !collapsed ? (
          <SidebarGroup>
            <SidebarGroupLabel>{ar ? "المفضلة" : "Favorites"}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {favoriteLinks.map((item) => (
                  <SidebarMenuItem key={`fav-${item.code}`}>
                    <SidebarMenuButton asChild isActive={isCurrent(item, pathname, search)}>
                      <Link to={item.to} search={item.search ?? {}}>
                        <Star className="size-4" aria-hidden />
                        <span>{ar ? item.labelAr : item.labelEn}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.map((group) =>
                group.items.length === 0 ? (
                  <SimpleGroup
                    key={group.code}
                    group={group}
                    ar={ar}
                    pathname={pathname}
                    search={search}
                  />
                ) : (
                  <ExpandableGroup
                    key={group.code}
                    group={group}
                    ar={ar}
                    collapsed={collapsed}
                    pathname={pathname}
                    search={search}
                    badges={badges}
                    favorites={favorites}
                    onToggleFavorite={toggle}
                  />
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function SimpleGroup({
  group,
  ar,
  pathname,
  search,
}: {
  group: NavGroup;
  ar: boolean;
  pathname: string;
  search: Record<string, unknown>;
}) {
  const target = GROUP_TARGET[group.code] ?? { to: "/dashboard" };
  const Icon = group.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isCurrent(target, pathname, search)}
        tooltip={ar ? group.labelAr : group.labelEn}
      >
        <Link to={target.to} search={target.search ?? {}}>
          <Icon className="size-4" aria-hidden />
          <span>{ar ? group.labelAr : group.labelEn}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ExpandableGroup({
  group,
  ar,
  collapsed,
  pathname,
  search,
  badges,
  favorites,
  onToggleFavorite,
}: {
  group: NavGroup;
  ar: boolean;
  collapsed: boolean;
  pathname: string;
  search: Record<string, unknown>;
  badges: BadgeCounts | undefined;
  favorites: string[];
  onToggleFavorite: (code: string) => void;
}) {
  const active = group.items.some((i) => isCurrent(i, pathname, search));
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const Icon = group.icon;
  const count = group.badge ? (badges?.[group.badge] ?? 0) : 0;

  if (collapsed) {
    const first = group.items[0] as NavLink | undefined;
    if (!first) return null;
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={ar ? group.labelAr : group.labelEn}>
          <Link to={first.to} search={first.search ?? {}}>
            <Icon className="size-4" aria-hidden />
            <span>{ar ? group.labelAr : group.labelEn}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={active} className="font-medium">
            <Icon className="size-4" aria-hidden />
            <span>{ar ? group.labelAr : group.labelEn}</span>
            {count > 0 ? (
              <Badge variant="secondary" className="ms-auto h-5 px-1.5 text-[11px]">
                {count}
              </Badge>
            ) : null}
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                count > 0 ? "ms-1" : "ms-auto",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {group.items.map((item) => (
              <SidebarMenuSubItem key={item.code} className="group/item relative">
                <SidebarMenuSubButton asChild isActive={isCurrent(item, pathname, search)}>
                  <Link to={item.to} search={item.search ?? {}}>
                    <span className="truncate">{ar ? item.labelAr : item.labelEn}</span>
                  </Link>
                </SidebarMenuSubButton>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(item.code)}
                  aria-label={ar ? "تثبيت" : "Pin"}
                  className="absolute inset-y-0 end-1 my-auto grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground md:hidden md:size-6 md:group-hover/item:grid"
                >
                  <Star
                    className={cn(
                      "size-3.5",
                      favorites.includes(item.code) && "fill-current text-primary",
                    )}
                    aria-hidden
                  />
                </button>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
