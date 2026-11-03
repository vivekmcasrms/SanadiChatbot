/**
 * Units & Performance — one page for cross-unit and Service Owner monitoring.
 * Deliberately university-wide, so it is never exposed to a Service Owner.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/auth-token";
import type { OwnerPerformanceRow } from "@/lib/admin/governance.functions";
import type { UnitMonitorRow } from "@/lib/monitoring/monitoring.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { StaffWorkloadPanel } from "@/components/admin/StaffWorkloadPanel";

export const Route = createFileRoute("/_authenticated/units")({
  head: () => ({
    meta: [
      { title: "Units & Performance — Sanadi | UAEU" },
      {
        name: "description",
        content: "Compare every UAEU service unit and Service Owner: workload, resolution time, SLA compliance and complaints.",
      },
      { property: "og:title", content: "Units & Performance — Sanadi | UAEU" },
      { property: "og:description", content: "University-wide service unit and owner performance monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnitsPage,
});

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const hrs = (v: number | null | undefined, ar: boolean) => (v == null ? "—" : ar ? `${v.toFixed(1)} س` : `${v.toFixed(1)}h`);

function UnitsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const canMonitorAll = roles.some((r) => ["system_admin", "service_manager", "leadership_viewer"].includes(r));

  const units = useQuery({
    queryKey: ["gov-units"],
    queryFn: () => apiFetch<UnitMonitorRow[]>("/api/v1/rpc/admin_unit_monitor"),
    enabled: canMonitorAll,
    retry: false,
  });
  const owners = useQuery({
    queryKey: ["gov-owners"],
    queryFn: () => apiFetch<OwnerPerformanceRow[]>("/api/v1/rpc/admin_owner_performance"),
    enabled: canMonitorAll,
    retry: false,
  });

  if (!canMonitorAll)
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {ar
              ? "مقارنة أداء الوحدات متاحة للإدارة فقط."
              : "University-wide performance comparison is available to administrators only."}
          </p>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "الوحدات والأداء" : "Units & performance"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "عبء العمل وزمن الحل والالتزام بالمدد لكل وحدة ولكل مالك خدمة."
            : "Workload, resolution time and SLA compliance for every unit and Service Owner."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "الوحدات" : "Service units"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-0">
          {units.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{ar ? "الوحدة" : "Unit"}</th>
                  <th className="p-3 text-start">{ar ? "نشطة" : "Active"}</th>
                  <th className="p-3 text-start">{ar ? "بانتظار المالك" : "With owner"}</th>
                  <th className="p-3 text-start">{ar ? "بانتظار الطالب" : "With student"}</th>
                  <th className="p-3 text-start">{ar ? "تحتاج متابعة" : "Attention"}</th>
                  <th className="p-3 text-start">{ar ? "تجاوزت المدة" : "Breached"}</th>
                  <th className="p-3 text-start">{ar ? "ردود متأخرة" : "Overdue"}</th>
                  <th className="p-3 text-start">{ar ? "بلاغات حرجة" : "Critical alerts"}</th>
                  <th className="p-3 text-start">{ar ? "وسيط زمن الحل" : "Median resolution"}</th>
                  <th className="p-3 text-end" />
                </tr>
              </thead>
              <tbody>
                {(units.data ?? []).map((u) => (
                  <tr key={u.unitId ?? u.unitEn} className="border-t">
                    <td className="p-3 font-medium">{ar ? u.unitAr : u.unitEn}</td>
                    <td className="p-3 tabular-nums">{u.active}</td>
                    <td className="p-3 tabular-nums">{u.ownerPending}</td>
                    <td className="p-3 tabular-nums">{u.studentPending}</td>
                    <td className="p-3 tabular-nums text-amber-600">{u.attention}</td>
                    <td className="p-3 tabular-nums text-destructive">{u.breached}</td>
                    <td className="p-3 tabular-nums">{u.responseOverdue}</td>
                    <td className="p-3 tabular-nums">{u.criticalAlerts}</td>
                    <td className="p-3 tabular-nums">{hrs(u.medianResolutionHours, ar)}</td>
                    <td className="p-3 text-end">
                      {u.unitId ? (
                        <Link
                          to="/monitoring"
                          search={{ unit: u.unitId, view: "open" }}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {ar ? "عرض الحالات" : "View cases"}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <StaffWorkloadPanel
        units={(units.data ?? [])
          .filter((u) => Boolean(u.unitId))
          .map((u) => ({ unitId: u.unitId as string, label: (ar ? u.unitAr : u.unitEn) ?? u.unitEn }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "أداء مالكي الخدمات" : "Service Owner performance"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-0">
          {owners.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : (owners.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {ar ? "لا توجد حالات مُسندة بعد." : "No assigned cases yet."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{ar ? "مالك الخدمة" : "Service Owner"}</th>
                  <th className="p-3 text-start">{ar ? "الوحدة" : "Unit"}</th>
                  <th className="p-3 text-start">{ar ? "مسندة" : "Assigned"}</th>
                  <th className="p-3 text-start">{ar ? "مفتوحة" : "Open"}</th>
                  <th className="p-3 text-start">{ar ? "تم حلها" : "Resolved"}</th>
                  <th className="p-3 text-start">{ar ? "مغلقة" : "Closed"}</th>
                  <th className="p-3 text-start">{ar ? "متأخرة" : "Overdue"}</th>
                  <th className="p-3 text-start">{ar ? "شكاوى" : "Complaints"}</th>
                  <th className="p-3 text-start">{ar ? "متوسط المعالجة" : "Avg. handling"}</th>
                  <th className="p-3 text-start">{ar ? "الالتزام بالمدة" : "SLA compliance"}</th>
                  <th className="p-3 text-start">{ar ? "نسبة الإنجاز" : "Resolution rate"}</th>
                </tr>
              </thead>
              <tbody>
                {(owners.data ?? []).map((o) => (
                  <tr key={o.owner_id} className="border-t">
                    <td className="p-3 font-medium">{o.owner_name}</td>
                    <td className="p-3 text-xs">{(ar ? o.unit_ar : o.unit_en) ?? "—"}</td>
                    <td className="p-3 tabular-nums">{o.assigned}</td>
                    <td className="p-3 tabular-nums">{o.open_cases}</td>
                    <td className="p-3 tabular-nums">{o.resolved}</td>
                    <td className="p-3 tabular-nums">{o.closed}</td>
                    <td className="p-3 tabular-nums text-destructive">{o.overdue}</td>
                    <td className="p-3 tabular-nums">{o.complaints}</td>
                    <td className="p-3 tabular-nums">{hrs(o.avg_handling_hours, ar)}</td>
                    <td className="p-3 tabular-nums">{pct(o.sla_compliance)}</td>
                    <td className="p-3 tabular-nums">{pct(o.resolution_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
