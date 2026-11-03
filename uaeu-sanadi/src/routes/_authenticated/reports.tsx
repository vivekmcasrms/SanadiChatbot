/**
 * Reports — a simple generator over real case records. Every number here is
 * computed in the database from the filtered set; nothing is hard-coded.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, ShieldAlert } from "lucide-react";
import { getGovernanceReportFn, getOwnerPerformanceFn, type GovernanceReport } from "@/lib/admin/governance.functions";
import { getUnitMonitorFn } from "@/lib/monitoring/monitoring.functions";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastError } from "@/lib/errors/toast";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Sanadi | UAEU" },
      {
        name: "description",
        content: "Generate service reports by date range, unit, Service Owner, interaction type and status, and export them.",
      },
      { property: "og:title", content: "Reports — Sanadi | UAEU" },
      { property: "og:description", content: "Real-data service reporting across every UAEU student service unit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const ALL = "all";
const hrs = (v: number | null | undefined, ar: boolean) => (v == null ? "—" : ar ? `${v.toFixed(1)} س` : `${v.toFixed(1)}h`);

function toCsv(report: GovernanceReport): string {
  const head = [
    "case_number",
    "title",
    "type",
    "status",
    "unit",
    "owner",
    "created_at",
    "completed_at",
    "resolution_due_at",
    "resolution_hours",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = report.rows.map((r) =>
    [
      r.case_number,
      r.title,
      r.case_type,
      r.status,
      r.unit_en ?? "",
      r.owner_name ?? "",
      r.created_at,
      r.completed_at ?? "",
      r.resolution_due_at ?? "",
      r.resolution_hours == null ? "" : r.resolution_hours.toFixed(2),
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

function ReportsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const canReport = roles.some((r) => ["system_admin", "service_manager", "leadership_viewer"].includes(r));

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [unit, setUnit] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [report, setReport] = useState<GovernanceReport | null>(null);

  const fetchUnits = useServerFn(getUnitMonitorFn);
  const fetchOwners = useServerFn(getOwnerPerformanceFn);
  const runReport = useServerFn(getGovernanceReportFn);

  const units = useQuery({ queryKey: ["report-units"], queryFn: () => fetchUnits(), enabled: canReport, retry: false });
  const owners = useQuery({ queryKey: ["report-owners"], queryFn: () => fetchOwners(), enabled: canReport, retry: false });

  const generate = useMutation({
    mutationFn: () =>
      runReport({
        data: {
          from,
          to,
          unit: unit === ALL ? null : unit,
          owner: owner === ALL ? null : owner,
          type: type === ALL ? null : type,
          status: status === ALL ? null : status,
        },
      }),
    onSuccess: (data) => setReport(data),
    onError: (err: unknown) => toastError(err, lang),
  });

  const slaCompliance = useMemo(() => {
    const m = report?.metrics;
    if (!m) return "—";
    const done = m.met_sla + m.breached_sla;
    return done === 0 ? "—" : `${Math.round((m.met_sla / done) * 100)}%`;
  }, [report]);

  function download() {
    if (!report) return;
    const blob = new Blob([`\uFEFF${toCsv(report)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sanadi-report-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!canReport)
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {ar ? "التقارير متاحة للإدارة فقط." : "Reports are available to administrators only."}
          </p>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "التقارير" : "Reports"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "تقارير مبنية على سجلات حقيقية: اختر الفترة والوحدة والمالك والنوع والحالة."
            : "Reports built from real records: choose period, unit, owner, interaction type and status."}
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="from">{ar ? "من" : "From"}</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">{ar ? "إلى" : "To"}</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{ar ? "الوحدة" : "Unit"}</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{ar ? "كل الوحدات" : "All units"}</SelectItem>
                {(units.data ?? [])
                  .filter((u) => u.unitId)
                  .map((u) => (
                    <SelectItem key={u.unitId!} value={u.unitId!}>
                      {ar ? u.unitAr : u.unitEn}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{ar ? "مالك الخدمة" : "Service Owner"}</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{ar ? "الجميع" : "All owners"}</SelectItem>
                {(owners.data ?? []).map((o) => (
                  <SelectItem key={o.owner_id} value={o.owner_id}>
                    {o.owner_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{ar ? "النوع" : "Interaction type"}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{ar ? "كل الأنواع" : "All types"}</SelectItem>
                <SelectItem value="query">{ar ? "استفسار" : "Query"}</SelectItem>
                <SelectItem value="complaint">{ar ? "شكوى" : "Complaint"}</SelectItem>
                <SelectItem value="suggestion">{ar ? "اقتراح" : "Suggestion"}</SelectItem>
                <SelectItem value="service_request">{ar ? "طلب خدمة" : "Service request"}</SelectItem>
                <SelectItem value="alert">{ar ? "بلاغ" : "Alert"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{ar ? "الحالة" : "Status"}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{ar ? "كل الحالات" : "All statuses"}</SelectItem>
                <SelectItem value="submitted">{ar ? "جديدة" : "Submitted"}</SelectItem>
                <SelectItem value="in_progress">{ar ? "قيد المعالجة" : "In progress"}</SelectItem>
                <SelectItem value="awaiting_student">{ar ? "بانتظار الطالب" : "Awaiting student"}</SelectItem>
                <SelectItem value="resolved">{ar ? "تم حلها" : "Resolved"}</SelectItem>
                <SelectItem value="closed">{ar ? "مغلقة" : "Closed"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? (ar ? "جارٍ التوليد…" : "Generating…") : ar ? "توليد التقرير" : "Generate report"}
            </Button>
            <Button variant="outline" onClick={download} disabled={!report} className="gap-2">
              <Download className="size-4" aria-hidden />
              {ar ? "تصدير CSV" : "Export CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MetricCard label={ar ? "إجمالي" : "Total"} value={report.metrics.total} />
            <MetricCard label={ar ? "استفسارات" : "Queries"} value={report.metrics.queries} />
            <MetricCard label={ar ? "شكاوى" : "Complaints"} value={report.metrics.complaints} />
            <MetricCard label={ar ? "اقتراحات" : "Suggestions"} value={report.metrics.suggestions} />
            <MetricCard label={ar ? "بلاغات" : "Alerts"} value={report.metrics.alerts} />
            <MetricCard label={ar ? "طلبات خدمة" : "Service requests"} value={report.metrics.requests} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MetricCard label={ar ? "تم حلها" : "Resolved"} value={report.metrics.resolved} tone="success" />
            <MetricCard label={ar ? "مغلقة" : "Closed"} value={report.metrics.closed} />
            <MetricCard label={ar ? "غير محلولة" : "Unresolved"} value={report.metrics.unresolved} tone="warning" />
            <MetricCard label={ar ? "متوسط زمن الحل" : "Avg. resolution"} value={hrs(report.metrics.avg_resolution_hours, ar)} />
            <MetricCard label={ar ? "الالتزام بالمدة" : "SLA compliance"} value={slaCompliance} />
            <MetricCard label={ar ? "تجاوز المدة" : "SLA breaches"} value={report.metrics.breached_sla} tone="danger" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{ar ? "حسب الوحدة" : "By unit"}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start">{ar ? "الوحدة" : "Unit"}</th>
                      <th className="p-3 text-start">{ar ? "الإجمالي" : "Total"}</th>
                      <th className="p-3 text-start">{ar ? "منجزة" : "Completed"}</th>
                      <th className="p-3 text-start">{ar ? "مفتوحة" : "Open"}</th>
                      <th className="p-3 text-start">{ar ? "متوسط الحل" : "Avg."}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byUnit.map((u) => (
                      <tr key={u.unit_en} className="border-t">
                        <td className="p-3">{ar ? u.unit_ar : u.unit_en}</td>
                        <td className="p-3 tabular-nums">{u.total}</td>
                        <td className="p-3 tabular-nums">{u.completed}</td>
                        <td className="p-3 tabular-nums">{u.open_cases}</td>
                        <td className="p-3 tabular-nums">{hrs(u.avg_resolution_hours, ar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{ar ? "حسب مالك الخدمة" : "By Service Owner"}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start">{ar ? "المالك" : "Owner"}</th>
                      <th className="p-3 text-start">{ar ? "الإجمالي" : "Total"}</th>
                      <th className="p-3 text-start">{ar ? "منجزة" : "Completed"}</th>
                      <th className="p-3 text-start">{ar ? "مفتوحة" : "Open"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byOwner.map((o) => (
                      <tr key={o.owner_name} className="border-t">
                        <td className="p-3">{o.owner_name}</td>
                        <td className="p-3 tabular-nums">{o.total}</td>
                        <td className="p-3 tabular-nums">{o.completed}</td>
                        <td className="p-3 tabular-nums">{o.open_cases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
