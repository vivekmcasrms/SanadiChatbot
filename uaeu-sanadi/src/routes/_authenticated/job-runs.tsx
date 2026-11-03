import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/MetricCard";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/job-runs")({
  head: () => ({
    meta: [
      { title: "Scheduled job runs — Sanadi | UAEU" },
      {
        name: "description",
        content: "Inspect every scheduled operations job run: status, processed counts, successes, failures and errors.",
      },
      { property: "og:title", content: "Scheduled job runs — Sanadi | UAEU" },
      { property: "og:description", content: "Monitor SLA sweeps, escalations, alerts and reminder jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobRunsPage,
});

const STATUSES = ["all", "running", "completed", "failed"] as const;
type StatusFilter = (typeof STATUSES)[number];

function statusTone(status: string) {
  if (status === "completed") return "bg-success/12 text-success";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "running") return "bg-info/10 text-info";
  return "bg-muted text-muted-foreground";
}

function duration(started: string, completed: string | null) {
  if (!completed) return "—";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function JobRunsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { isStaff, loading } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [job, setJob] = useState("");

  const runsQuery = useQuery({
    queryKey: ["job-runs", status, job],
    enabled: isStaff,
    queryFn: async () => {
      let q = supabase
        .from("scheduled_job_runs")
        .select("id, job_name, started_at, completed_at, status, records_processed, successes, failures, skipped, truncated, error_summary")
        .order("started_at", { ascending: false })
        .limit(200);
      if (status !== "all") q = q.eq("status", status);
      if (job.trim()) q = q.ilike("job_name", `%${job.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading) return <p className="p-6 text-sm text-muted-foreground">…</p>;
  if (!isStaff) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {ar ? "هذه الصفحة متاحة لفريق الخدمة فقط." : "This page is available to service staff only."}
      </p>
    );
  }

  const rows = runsQuery.data ?? [];
  const failed = rows.filter((r) => r.status === "failed").length;
  const running = rows.filter((r) => r.status === "running").length;
  const processed = rows.reduce((sum, r) => sum + (r.records_processed ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{ar ? "سجل المهام المجدولة" : "Scheduled job runs"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "تفقد حالة كل تشغيل وعدد السجلات المعالجة والأخطاء."
            : "Inspect each run's status, processed counts and errors."}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "عمليات التشغيل" : "Runs shown"} value={rows.length} />
        <MetricCard label={ar ? "قيد التشغيل" : "Running"} value={running} tone={running ? "warning" : "default"} />
        <MetricCard label={ar ? "فشل" : "Failed"} value={failed} tone={failed ? "danger" : "success"} />
        <MetricCard label={ar ? "السجلات المعالجة" : "Records processed"} value={processed} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {s}
          </Button>
        ))}
        <Input
          className="h-9 w-56"
          placeholder={ar ? "اسم المهمة" : "Filter by job name"}
          value={job}
          onChange={(e) => setJob(e.target.value)}
        />
        <Button size="sm" variant="ghost" onClick={() => void qc.invalidateQueries({ queryKey: ["job-runs"] })}>
          {ar ? "تحديث" : "Refresh"}
        </Button>
      </div>

      <section className="card-shadow overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{ar ? "المهمة" : "Job"}</th>
              <th className="p-3 text-start">{ar ? "الحالة" : "Status"}</th>
              <th className="p-3 text-start">{ar ? "البداية" : "Started"}</th>
              <th className="p-3 text-start">{ar ? "المدة" : "Duration"}</th>
              <th className="p-3 text-end">{ar ? "معالج" : "Processed"}</th>
              <th className="p-3 text-end">{ar ? "نجاح" : "OK"}</th>
              <th className="p-3 text-end">{ar ? "فشل" : "Fail"}</th>
              <th className="p-3 text-end">{ar ? "تخطّي" : "Skipped"}</th>
              <th className="p-3 text-start">{ar ? "الخطأ" : "Error"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-3 font-medium">{r.job_name.replaceAll("_", " ")}</td>
                <td className="p-3">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusTone(r.status))}>
                    {r.status}
                  </span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
                <td className="p-3 text-xs tabular-nums text-muted-foreground">{duration(r.started_at, r.completed_at)}</td>
                <td className="p-3 text-end tabular-nums">{r.records_processed}</td>
                <td className="p-3 text-end tabular-nums">{r.successes}</td>
                <td className={cn("p-3 text-end tabular-nums", r.failures > 0 && "text-destructive")}>{r.failures}</td>
                <td className="p-3 text-end tabular-nums text-muted-foreground">{r.skipped}</td>
                <td className="max-w-sm p-3 text-xs whitespace-pre-wrap text-destructive">{r.error_summary ?? (r.truncated ? (ar ? "توقف عند الحد الزمني؛ يكمل التشغيل التالي" : "Stopped at time limit; next run continues") : "—")}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                  {runsQuery.isLoading ? "…" : ar ? "لا توجد عمليات تشغيل" : "No job runs recorded yet"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}