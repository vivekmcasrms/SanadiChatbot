/**
 * Lean Service Owner dashboard — "what is happening in my service?".
 *
 * Every number comes from a live, unit-scoped database count. No BI, no SLA
 * administration, no university-wide analytics.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Inbox, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { StatusChip } from "@/components/StatusChip";
import { InteractionTypeBadge } from "@/components/InteractionTypeBadge";
import { CardListSkeleton } from "@/components/ListSkeleton";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { getOwnerDashboardFn } from "@/lib/owner.functions";

const TYPE_ROWS = [
  { key: "query", en: "Queries", ar: "استفسارات" },
  { key: "complaint", en: "Complaints", ar: "شكاوى" },
  { key: "suggestion", en: "Suggestions", ar: "مقترحات" },
  { key: "alert", en: "Alerts", ar: "تنبيهات" },
  { key: "service_request", en: "Requests", ar: "طلبات خدمة" },
] as const;

export function OwnerDashboard({ enabled, unitId }: { enabled: boolean; unitId: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["owner-dashboard", unitId ?? "all"],
    enabled: enabled && Boolean(user),
    retry: false,
    queryFn: () => getOwnerDashboardFn({ data: { unitId, days: 30 } }),
  });

  const byType = data?.byType;
  const byStatus = data?.byStatus;
  const max = Math.max(1, ...TYPE_ROWS.map((r) => byType?.[r.key] ?? 0));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {ar ? "آخر ٣٠ يوماً — لخدمتك فقط." : "Last 30 days — your service only."}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={ar ? "إجمالي التفاعلات" : "Total interactions"}
          value={data?.total ?? 0}
          icon={<Inbox className="size-4" aria-hidden />}
        />
        <MetricCard
          label={ar ? "يحتاج انتباهك" : "Needs your attention"}
          value={data?.attention ?? 0}
          tone={(data?.attention ?? 0) > 0 ? "danger" : "success"}
          icon={<AlertTriangle className="size-4" aria-hidden />}
        />
        <MetricCard
          label={ar ? "قيد التنفيذ" : "In progress"}
          value={byStatus?.inProgress ?? 0}
          icon={<Timer className="size-4" aria-hidden />}
        />
        <MetricCard
          label={ar ? "تم حلها" : "Resolved"}
          value={byStatus?.resolved ?? 0}
          tone="success"
          icon={<CheckCircle2 className="size-4" aria-hidden />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "توزيع التفاعلات" : "Interaction breakdown"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {TYPE_ROWS.map((row) => {
              const count = byType?.[row.key] ?? 0;
              return (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{ar ? row.ar : row.en}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((count / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "ملخص الحالة" : "Resolution summary"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {[
              { label: ar ? "مفتوحة" : "Open", value: byStatus?.open ?? 0 },
              { label: ar ? "قيد التنفيذ" : "In progress", value: byStatus?.inProgress ?? 0 },
              { label: ar ? "بانتظار الطالب" : "Waiting for student", value: byStatus?.waitingStudent ?? 0 },
              { label: ar ? "تم حلها" : "Resolved", value: byStatus?.resolved ?? 0 },
              { label: ar ? "مغلقة" : "Closed", value: byStatus?.closed ?? 0 },
            ].map((r) => (
              <p key={r.label} className="flex items-center justify-between border-b py-1.5 last:border-0">
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">{r.value}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{ar ? "أحدث النشاط" : "Recent activity"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <CardListSkeleton rows={3} /> : null}
          {!isLoading && (data?.recent ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{ar ? "لا يوجد نشاط بعد." : "No activity yet."}</p>
          ) : null}
          {(data?.recent ?? []).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-0 last:pb-0">
              <InteractionTypeBadge type={c.case_type} />
              <Link
                to="/requests/$caseId"
                params={{ caseId: c.id }}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {c.title}
              </Link>
              <StatusChip status={c.status} />
              <span className="text-xs text-muted-foreground">{formatDate(c.created_at, lang)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
