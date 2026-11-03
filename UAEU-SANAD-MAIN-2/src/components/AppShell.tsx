import { Link, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Globe,
  LifeBuoy,
  LogOut,
  Menu,
  Search,
  Settings,
  User,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { apiSignOut } from "@/lib/api-auth";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandMenu, useCommandMenu } from "@/components/CommandMenu";
import { SanadiLogo } from "@/components/SanadiLogo";
import { NotificationBell } from "@/components/NotificationBell";
import { TestEnvironmentBanner } from "@/components/TestEnvironmentBanner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { crumbsFor, STUDENT_PRIMARY_NAV, STUDENT_SERVICES_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth();

  if (!isStaff) return <StudentShell>{children}</StudentShell>;
  return (
    <>
      <TestEnvironmentBanner />
      <AdminShell>{children}</AdminShell>
    </>
  );
}

function useSignOut() {
  const queryClient = useQueryClient();
  return async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await apiSignOut(true);
  };
}

function AccountMenu() {
  const { lang, setLang } = useI18n();
  const ar = lang === "ar";
  const { profile } = useAuth();
  const signOut = useSignOut();

  // Prefer the person's name; fall back to the email handle only if unnamed.
  const fullName = profile?.full_name?.trim();
  const displayName = fullName || profile?.email?.split("@")[0] || "";
  const shortName = fullName
    ? [
        fullName.split(/\s+/)[0],
        fullName.split(/\s+/).length > 1 ? fullName.split(/\s+/).slice(-1)[0] : null,
      ]
        .filter(Boolean)
        .join(" ")
    : displayName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2 data-[state=open]:bg-secondary">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <User className="size-4" aria-hidden />
          </span>
          <span className="hidden max-w-[12rem] truncate sm:inline">{shortName}</span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:inline" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate">
          <span className="block truncate font-medium">{displayName}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {profile?.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <User className="size-4" aria-hidden />
            {ar ? "ملفي الشخصي" : "My Profile"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" hash="preferences">
            <Settings className="size-4" aria-hidden />
            {ar ? "التفضيلات والإشعارات" : "Preferences & Notifications"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Globe className="size-4" aria-hidden />
            {ar ? "اللغة" : "Language"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setLang("en")}>
              <Check className={cn("size-4", lang !== "en" && "opacity-0")} aria-hidden />
              English
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLang("ar")}>
              <Check className={cn("size-4", lang !== "ar" && "opacity-0")} aria-hidden />
              العربية
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link to="/help">
            <LifeBuoy className="size-4" aria-hidden />
            {ar ? "المساعدة والخدمات" : "Help & Services"}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden />
          {ar ? "تسجيل الخروج" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Crumbs() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const crumbs = crumbsFor(pathname, search);
  if (crumbs.length === 0) return null;
  return (
    <Breadcrumb className="hidden sm:block">
      <BreadcrumbList>
        {crumbs.map((c, i) => (
          <Fragment key={`${c.labelEn}-${i}`}>
            <BreadcrumbItem>
              {i < crumbs.length - 1 ? (
                <BreadcrumbLink asChild>
                  <span className="text-muted-foreground">{ar ? c.labelAr : c.labelEn}</span>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{ar ? c.labelAr : c.labelEn}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {i < crumbs.length - 1 ? <BreadcrumbSeparator /> : null}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { open, setOpen } = useCommandMenu();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/90 px-3 pt-3 backdrop-blur sm:gap-3 sm:px-4">
            <SidebarTrigger className="shrink-0" />
            <Link
              to="/"
              aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
              className="inline-flex min-h-11 shrink-0 items-center rounded-md md:hidden"
            >
              <SanadiLogo withName={false} compactOnly />
            </Link>
            <Crumbs />
            <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 px-2 sm:px-3"
                aria-label={ar ? "بحث" : "Search"}
                onClick={() => setOpen(true)}
              >
                <Search className="size-4" aria-hidden />
                <span className="hidden sm:inline">{ar ? "بحث" : "Search"}</span>
                <kbd className="hidden rounded border px-1 text-[10px] text-muted-foreground md:inline">
                  ⌘K
                </kbd>
              </Button>
              <NotificationBell />
              <AccountMenu />
            </div>
          </header>
          <main className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
            {children}
          </main>
        </SidebarInset>
      </div>
      <CommandMenu open={open} onOpenChange={setOpen} />
    </SidebarProvider>
  );
}

const navItemClass =
  "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const navItemActiveClass = "bg-secondary text-foreground";

function StudentShell({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const servicesActive = STUDENT_SERVICES_NAV.some((item) =>
    pathname.startsWith(item.to.replace("/$type", "")),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/90 pt-3 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4">
          <Link
            to="/"
            aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
            className="inline-flex min-h-11 shrink-0 items-center rounded-md text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SanadiLogo compactOnly />
          </Link>

          <nav
            className="mx-auto hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex"
            aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}
          >
            {STUDENT_PRIMARY_NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.code}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(navItemClass, active && navItemActiveClass)}
                >
                  {ar ? item.labelAr : item.labelEn}
                </Link>
              );
            })}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    navItemClass,
                    "group inline-flex items-center gap-1.5 data-[state=open]:bg-secondary data-[state=open]:text-foreground",
                    servicesActive && navItemActiveClass,
                  )}
                >
                  {ar ? "الخدمات" : "Services"}
                  <ChevronDown
                    className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
                    aria-hidden
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-72">
                {STUDENT_SERVICES_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.code} asChild className="items-start gap-3 py-2">
                      <Link to={item.to} params={(item.params ?? {}) as never}>
                        {Icon ? (
                          <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {ar ? item.labelAr : item.labelEn}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {ar ? item.descriptionAr : item.descriptionEn}
                          </span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <NotificationBell />
            <AccountMenu />
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 lg:hidden"
                  aria-label={ar ? "فتح قائمة التنقل" : "Open navigation menu"}
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side={ar ? "left" : "right"}
                className="flex w-[min(86vw,22rem)] flex-col p-0"
                dir={ar ? "rtl" : "ltr"}
              >
                <SheetHeader className="border-b px-5 py-5 text-start">
                  <SheetTitle className="pe-8">
                    <SheetClose asChild>
                      <Link
                        to="/"
                        aria-label={ar ? "الانتقال إلى صفحة سندي الرئيسية" : "Go to Sanadi home"}
                        className="inline-flex rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SanadiLogo compactOnly />
                      </Link>
                    </SheetClose>
                  </SheetTitle>
                </SheetHeader>
                <nav
                  className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
                  aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}
                >
                  {STUDENT_PRIMARY_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = pathname.startsWith(item.to);
                    return (
                      <SheetClose asChild key={item.code}>
                        <Link
                          to={item.to}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                            active && "bg-secondary text-primary",
                          )}
                        >
                          {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
                          <span className="truncate">{ar ? item.labelAr : item.labelEn}</span>
                        </Link>
                      </SheetClose>
                    );
                  })}

                  <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ar ? "الخدمات" : "Services"}
                  </p>
                  {STUDENT_SERVICES_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = pathname.startsWith(item.to.replace("/$type", ""));
                    return (
                      <SheetClose asChild key={item.code}>
                        <Link
                          to={item.to}
                          params={(item.params ?? {}) as never}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                            active && "bg-secondary text-primary",
                          )}
                        >
                          {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
                          <span className="truncate">{ar ? item.labelAr : item.labelEn}</span>
                        </Link>
                      </SheetClose>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
