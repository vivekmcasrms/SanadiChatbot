import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { CardListSkeleton } from "@/components/ListSkeleton";
import { useI18n } from "@/lib/i18n";
import { apiFetch } from "@/lib/auth-token";
import type { PerformanceDashboard } from "@/lib/quality.functions";

const TARGETS: Record<string, number> = {
  simple_factual: 2000,
  student_data: 4000,
  policy_interpretation: 6000,
  multi_step_action: 8000,
  complaint_intake: 5000,
};

function ms(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

/** Live latency, throughput and bottleneck view for admins and managers. */
export function PerformancePanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [windowHours, setWindowHours] = useState("24");
  const [path, setPath] = useState("all");
  const q = useQuery({
    queryKey: ["perf-dashboard", windowHours, path],
    queryFn: () =>
      apiFetch<PerformanceDashboard>("/api/quality/performance", {
        method: "POST",
        body: JSON.stringify({
          windowHours: Number(windowHours),
          ...(path === "all" ? {} : { path }),
        }),
      }),
    refetchInterval: 60_000,
  });

  if (q.isLoading) return <CardListSkeleton rows={5} />;
  const d = q.data;
  if (!d) return null;

  const slowestPhase = [...d.phases].sort((a, b) => b.p95 - a.p95)[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={windowHours} onValueChange={setWindowHours}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{ar ? "آخر ساعة" : "Last hour"}</SelectItem>
            <SelectItem value="24">{ar ? "آخر 24 ساعة" : "Last 24 hours"}</SelectItem>
            <SelectItem value="168">{ar ? "آخر 7 أيام" : "Last 7 days"}</SelectItem>
            <SelectItem value="720">{ar ? "آخر 30 يوماً" : "Last 30 days"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={path} onValueChange={setPath}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "كل المسارات" : "All execution paths"}</SelectItem>
            <SelectItem value="agentic">{ar ? "المسار الوكيلي" : "Agentic"}</SelectItem>
            <SelectItem value="fast_path">{ar ? "المسار السريع" : "Fast path"}</SelectItem>
            <SelectItem value="rule_engine">{ar ? "محرك القواعد" : "Rule engine"}</SelectItem>
            <SelectItem value="deterministic_fallback">{ar ? "البديل الحتمي" : "Deterministic fallback"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "الطلبات" : "Requests"} value={d.totals.requests} />
        <MetricCard label={ar ? "طلبات/دقيقة" : "Requests / min"} value={d.totals.requestsPerMinute} />
        <MetricCard label={ar ? "زمن الاستجابة (95%)" : "P95 latency"} value={ms(d.overall.p95)} />
        <MetricCard label={ar ? "نسبة الأخطاء" : "Error rate"} value={`${d.totals.errorRate}%`} />
        <MetricCard label={ar ? "الوسيط (50%)" : "P50 latency"} value={ms(d.overall.p50)} />
        <MetricCard label="P99" value={ms(d.overall.p99)} />
        <MetricCard label={ar ? "أول تفاعل مرئي (95%)" : "First feedback P95"} value={ms(d.overall.firstFeedbackP95)} />
        <MetricCard label={ar ? "حدود المعدل" : "Rate-limit events"} value={d.totals.rateLimitEvents} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {ar ? "الالتزام بالأهداف حسب نوع الاستجابة" : "Target compliance by response type"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.byCategory.length === 0 && (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد بيانات بعد." : "No traffic in this window."}</p>
          )}
          {d.byCategory.map((c) => {
            const target = TARGETS[c.category] ?? 8000;
            const ok = c.p95 <= target;
            return (
              <div key={c.category} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-40">
                  <p className="text-sm font-medium">{c.category.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.samples} {ar ? "طلب" : "requests"} · {ar ? "الهدف" : "target"} {ms(target)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span>P50 {ms(c.p50)}</span>
                  <span>P95 {ms(c.p95)}</span>
                  <span>P99 {ms(c.p99)}</span>
                  <Badge variant={ok ? "secondary" : "destructive"}>
                    {ok ? (ar ? "ضمن الهدف" : "Within target") : ar ? "تجاوز" : "Over target"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "الاختناقات حسب المرحلة" : "Bottlenecks by phase"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {slowestPhase && (
              <p className="text-xs text-muted-foreground">
                {ar ? "أبطأ مرحلة:" : "Slowest phase:"} <strong>{slowestPhase.phase}</strong> ({ms(slowestPhase.p95)}{" "}
                P95)
              </p>
            )}
            {d.phases.map((p) => (
              <div key={p.phase} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="capitalize">{p.phase}</span>
                  <span className="text-muted-foreground">
                    P50 {ms(p.p50)} · P95 {ms(p.p95)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (p.p95 / Math.max(1, d.overall.p95)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "المسارات والنماذج" : "Execution paths & models"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {d.byPath.map((p) => (
              <div key={p.path} className="flex items-center justify-between rounded-md border p-2">
                <span className="font-medium">{p.path.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">
                  {p.share}% · P95 {ms(p.p95)}
                </span>
              </div>
            ))}
            {d.byModel.map((m) => (
              <div key={m.model} className="flex items-center justify-between rounded-md border p-2">
                <span className="truncate font-medium">{m.model}</span>
                <span className="text-muted-foreground">
                  {m.samples} · P95 {ms(m.p95)}
                </span>
              </div>
            ))}
            <p className="pt-1 text-muted-foreground">
              {ar ? "متوسط استدعاءات النموذج" : "Avg model calls"}: {d.totals.avgModelCalls} ·{" "}
              {ar ? "متوسط الرموز" : "avg tokens"}: {d.totals.avgTokens}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{ar ? "أبطأ الطلبات" : "Slowest requests"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.slowest.map((s, i) => (
            <div key={s.traceId ?? i} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{s.category.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">
                  {ms(s.totalMs)} · {s.path} · {s.modelCalls} {ar ? "استدعاء" : "model calls"} · {s.toolCount}{" "}
                  {ar ? "أداة" : "tools"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.breakdown.map((b) => (
                  <Badge key={b.label} variant="outline" className="text-[10px]">
                    {b.label} {ms(b.ms)}
                  </Badge>
                ))}
                {s.errorKind && (
                  <Badge variant="destructive" className="text-[10px]">
                    {s.errorKind}
                  </Badge>
                )}
              </div>
            </div>
          ))}
          {d.slowest.length === 0 && (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد بيانات بعد." : "No traffic in this window."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
