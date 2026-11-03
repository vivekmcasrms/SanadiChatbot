import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useStaffMetrics } from "@/lib/metrics";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QUICK_ACTIONS, allowed, isGovernanceAdmin, isServiceOwnerOnly, visibleNav } from "@/lib/nav";
import { AdminOverview } from "@/components/admin/AdminOverview";

type DashboardSearch = { view?: string | undefined };

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    view: typeof search['view'] === "string" ? (search['view'] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Staff Dashboard — Sanadi | UAEU" },
      { name: "description", content: "Role-aware operational overview for UAEU student service staff." },
      { property: "og:title", content: "Staff Dashboard — Sanadi | UAEU" },
      { property: "og:description", content: "Role-aware operational overview for UAEU student service staff." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles, isStaff, profile } = useAuth();
  const { view } = Route.useSearch();
  const metrics = useStaffMetrics(isStaff);
  const groups = visibleNav(roles);
  const actions = QUICK_ACTIONS.filter((a) => allowed(roles, a.roles));
  const navigate = useNavigate();

  // A pure Service Owner has one landing question: "what needs my attention?".
  const ownerOnly = isServiceOwnerOnly(roles);
  useEffect(() => {
    if (ownerOnly) void navigate({ to: "/owner-console", search: { tab: "dashboard" }, replace: true });
  }, [ownerOnly, navigate]);
  if (ownerOnly) return null;

  // An administrator lands on the university-wide executive snapshot instead of
  // the per-queue staff metrics.
  if (isGovernanceAdmin(roles) && !view) return <AdminOverview />;


  const heading =
    view === "audit"
      ? ar
        ? "نظرة التدقيق"
        : "Audit overview"
      : view === "insights"
        ? ar
          ? "التحليلات"
          : "Insights"
        : ar
          ? "لوحة المعلومات"
          : "Dashboard";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          {ar ? "مرحباً" : "Welcome"} {profile?.full_name ?? profile?.email ?? ""}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label={ar ? "الحالات المفتوحة" : "Open cases"}
          value={metrics.data?.open ?? 0}        />
        <MetricCard
          label={ar ? "متأخرة" : "Overdue"}
          value={metrics.data?.overdue ?? 0}        />
        <MetricCard
          label={ar ? "مصعّدة" : "Escalated"}
          value={metrics.data?.escalated ?? 0}        />
        <MetricCard
          label={ar ? "مقترحات مفتوحة" : "Open suggestions"}
          value={metrics.data?.suggestionsOpen ?? 0}        />
      </div>

      {actions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ar ? "إجراءات سريعة" : "Quick actions"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.code} asChild variant="outline" size="sm" className="gap-2">
                <Link to={a.to} search={a.search ?? {}}>
                  {a.icon ? <a.icon className="size-4" aria-hidden /> : null}
                  {ar ? a.labelAr : a.labelEn}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {groups
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <Card key={group.code}>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <group.icon className="size-4 text-primary" aria-hidden />
                <CardTitle className="text-base">{ar ? group.labelAr : group.labelEn}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.code}
                    to={item.to}
                    search={item.search ?? {}}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <span>{ar ? item.labelAr : item.labelEn}</span>
                    <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
