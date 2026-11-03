/**
 * Admin dashboard: "how is Sanadi performing across the university?".
 *
 * Executive only — interaction volumes, service performance, the units that
 * genuinely need attention and a short activity feed. No technical AI metrics.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/auth-token";
import type { AdminOverview } from "@/lib/admin/governance.functions";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";


const hrs = (v: number | null | undefined, ar: boolean) =>
  v == null ? "—" : ar ? `${v.toFixed(1)} س` : `${v.toFixed(1)}h`;

export function AdminOverview() {
  const { lang } = useI18n();
  const { session, loading } = useAuth();
  const ar = lang === "ar";
  const q = useQuery({
    queryKey: ["admin-overview", session?.user.id ?? null],
    queryFn: () => apiFetch<AdminOverview>("/api/v1/rpc/admin_governance_overview"),
    enabled: !loading && !!session,
    retry: false,
  });

  if (loading || !session || q.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (q.error)
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {(q.error as Error).message}
      </p>
    );

  const d = q.data;
  const t = d?.totals;
  const p = d?.performance;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ar ? "التفاعلات على مستوى الجامعة" : "University-wide interactions"}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <MetricCard label={ar ? "إجمالي التفاعلات" : "Total interactions"} value={t?.total ?? 0} />
          <MetricCard label={ar ? "استفسارات" : "Queries"} value={t?.queries ?? 0} />
          <MetricCard label={ar ? "شكاوى" : "Complaints"} value={t?.complaints ?? 0} />
          <MetricCard label={ar ? "اقتراحات" : "Suggestions"} value={t?.suggestions ?? 0} />
          <MetricCard label={ar ? "بلاغات" : "Alerts"} value={t?.alerts ?? 0} />
          <MetricCard label={ar ? "طلبات خدمة" : "Service requests"} value={t?.requests ?? 0} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label={ar ? "مفتوحة" : "Open"} value={t?.open_new ?? 0} />
          <MetricCard label={ar ? "قيد المعالجة" : "In progress"} value={t?.in_progress ?? 0} />
          <MetricCard label={ar ? "تم حلها" : "Resolved"} value={t?.resolved ?? 0} tone="success" />
          <MetricCard label={ar ? "مغلقة" : "Closed"} value={t?.closed ?? 0} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ar ? "أداء الخدمة" : "Service performance"}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard
            label={ar ? "متوسط زمن الحل" : "Avg. resolution time"}
            value={hrs(p?.avg_resolution_hours ?? null, ar)}
          />
          <MetricCard label={ar ? "ضمن المدة" : "Within SLA"} value={p?.within_sla ?? 0} tone="success" />
          <MetricCard
            label={ar ? "تقترب من المدة" : "Approaching SLA"}
            value={p?.approaching_sla ?? 0}
            tone="warning"
          />
          <MetricCard label={ar ? "تجاوزت المدة" : "SLA breached"} value={p?.breached_sla ?? 0} tone="danger" />
          <MetricCard
            label={ar ? "بلاغات حرجة مفتوحة" : "Critical alerts open"}
            value={p?.critical_alerts ?? 0}
            tone={(p?.critical_alerts ?? 0) > 0 ? "danger" : "default"}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
            <CardTitle className="text-base">{ar ? "وحدات تحتاج انتباهاً" : "Units requiring attention"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(d?.unitsNeedingAttention ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ar ? "لا توجد وحدات تحتاج تدخلاً الآن." : "No unit needs intervention right now."}
              </p>
            ) : (
              (d?.unitsNeedingAttention ?? []).map((u) => (
                <Link
                  key={u.unit_id}
                  to="/monitoring"
                  search={{ unit: u.unit_id, view: "open" }}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-secondary"
                >
                  <span className="min-w-0 truncate font-medium">{ar ? u.name_ar : u.name_en}</span>
                  <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
                    <span>{ar ? `مفتوحة ${u.open_cases}` : `${u.open_cases} open`}</span>
                    {u.breached > 0 ? (
                      <span className="text-destructive">
                        {ar ? `تجاوز ${u.breached}` : `${u.breached} breached`}
                      </span>
                    ) : null}
                    {u.open_complaints > 0 ? (
                      <span>{ar ? `شكاوى ${u.open_complaints}` : `${u.open_complaints} complaints`}</span>
                    ) : null}
                    <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ar ? "النشاط الأخير" : "Recent activity"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(d?.recent ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{ar ? "لا يوجد نشاط بعد." : "No activity yet."}</p>
            ) : (
              (d?.recent ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 border-b pb-1.5 text-sm last:border-0">
                  <span className="min-w-0">
                    <span className="font-medium">{r.caseNumber}</span>{" "}
                    <span className="text-muted-foreground">{r.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {(ar ? r.unitAr : r.unitEn) ?? (ar ? "غير مُسندة" : "Unassigned")} · {r.status.replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {new Date(r.at).toLocaleString(ar ? "ar-AE" : "en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
