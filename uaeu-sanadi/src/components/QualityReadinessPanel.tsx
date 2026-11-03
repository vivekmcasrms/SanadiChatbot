import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError } from "@/lib/errors/toast";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleDashed, Gauge, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { useI18n } from "@/lib/i18n";
import {
  getQualityDashboard,
  runConsistencyCheck,
  setServiceState,
  updateReadinessGate,
} from "@/lib/quality.functions";

const STATUS_TONE: Record<string, string> = {
  passed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  waived: "bg-muted text-muted-foreground",
  not_started: "bg-muted text-muted-foreground",
};

export function QualityPanel({ isAdmin }: { isAdmin: boolean }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const dashboardFn = useServerFn(getQualityDashboard);
  const gateFn = useServerFn(updateReadinessGate);
  const stateFn = useServerFn(setServiceState);
  const consistencyFn = useServerFn(runConsistencyCheck);

  const { data, isLoading } = useQuery({ queryKey: ["quality-dashboard"], queryFn: () => dashboardFn({}) });

  const gate = useMutation({
    mutationFn: (vars: { gateKey: string; status: "passed" | "failed" | "in_progress" | "waived" }) =>
      gateFn({ data: vars }),
    onSuccess: () => {
      toast.success(ar ? "تم تحديث البوابة" : "Gate updated");
      void qc.invalidateQueries({ queryKey: ["quality-dashboard"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const health = useMutation({
    mutationFn: (vars: {
      component: "ai_provider" | "knowledge_retrieval" | "student_information" | "case_management" | "maintenance";
      state: "operational" | "degraded" | "outage" | "maintenance";
    }) => stateFn({ data: vars }),
    onSuccess: () => {
      toast.success(ar ? "تم تحديث حالة الخدمة" : "Service state updated");
      void qc.invalidateQueries({ queryKey: ["quality-dashboard"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const consistency = useMutation({
    mutationFn: () => consistencyFn({}),
    onError: (e: Error) => toastError(e, lang),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل..." : "Loading..."}</p>;
  if (!data) return null;

  const blocking = data.readiness.filter((g) => g.isBlocking && g.status !== "passed").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "الاستناد للمصادر" : "Grounding pass rate"} value={`${data.grounding.passRate}%`} />
        <MetricCard label={ar ? "متوسط درجة الاستناد" : "Avg grounding score"} value={`${data.grounding.avgScore}`} />
        <MetricCard label={ar ? "أول استجابة مرئية (95%)" : "First feedback P95"} value={`${data.firstFeedbackP95} ms`} />
        <MetricCard label={ar ? "الأعطال الجزئية" : "Partial failures"} value={`${data.reliability.partialFailureRate}%`} />
      </div>

      <section className="rounded-xl border card-shadow">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{ar ? "أهداف الجودة" : "Quality targets"}</h3>
        </header>
        <div className="divide-y">
          {data.targets.map((t) => (
            <div key={t.metricKey} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{ar ? t.labelAr : t.labelEn}</p>
                <p className="text-xs text-muted-foreground">
                  {ar ? "الهدف" : "Target"}: {t.comparator === "lte" ? "≤" : "≥"} {t.target}
                  {t.unit === "percent" ? "%" : t.unit === "ms" ? " ms" : ""} · n={t.sampleSize}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">
                  {t.measured == null ? "—" : `${t.measured}${t.unit === "percent" ? "%" : t.unit === "ms" ? " ms" : ""}`}
                </span>
                {t.meets == null ? (
                  <CircleDashed className="h-4 w-4 text-muted-foreground" />
                ) : t.meets ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border card-shadow">
        <header className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{ar ? "زمن الاستجابة حسب نوع الطلب" : "Latency by response type"}</h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start">{ar ? "النوع" : "Category"}</th>
                <th className="px-3 py-2 text-end">P50</th>
                <th className="px-3 py-2 text-end">P90</th>
                <th className="px-3 py-2 text-end">P95</th>
                <th className="px-3 py-2 text-end">P99</th>
                <th className="px-3 py-2 text-end">{ar ? "الميزانية" : "Budget"}</th>
                <th className="px-3 py-2 text-end">{ar ? "تجاوزات" : "Breaches"}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.latency.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    {ar ? "لا توجد قياسات بعد" : "No measurements yet"}
                  </td>
                </tr>
              ) : (
                data.latency.map((l) => (
                  <tr key={l.category}>
                    <td className="px-4 py-2">{l.category.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-end font-mono">{l.p50}</td>
                    <td className="px-3 py-2 text-end font-mono">{l.p90}</td>
                    <td className="px-3 py-2 text-end font-mono">{l.p95}</td>
                    <td className="px-3 py-2 text-end font-mono">{l.p99}</td>
                    <td className="px-3 py-2 text-end font-mono">{l.budgetMs ?? "—"}</td>
                    <td className="px-3 py-2 text-end">{l.breaches}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border card-shadow">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{ar ? "جاهزية الإطلاق" : "Release readiness"}</h3>
          </div>
          <Badge variant={blocking ? "destructive" : "secondary"}>
            {blocking
              ? ar
                ? `${blocking} بوابة مانعة`
                : `${blocking} blocking gate(s)`
              : ar
                ? "جاهز للتجربة"
                : "Ready for pilot"}
          </Badge>
        </header>
        <div className="divide-y">
          {data.readiness.map((g) => (
            <div key={g.gateKey} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{ar ? g.labelAr : g.labelEn}</p>
                {g.notes ? <p className="text-xs text-muted-foreground">{g.notes}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[g.status] ?? ""}`}>
                  {g.status.replace(/_/g, " ")}
                </span>
                {isAdmin ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => gate.mutate({ gateKey: g.gateKey, status: "passed" })}>
                      {ar ? "اجتياز" : "Pass"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => gate.mutate({ gateKey: g.gateKey, status: "failed" })}>
                      {ar ? "إخفاق" : "Fail"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border card-shadow">
        <header className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{ar ? "حالة الخدمات" : "Service health"}</h3>
        </header>
        <div className="divide-y">
          {data.health.map((h) => (
            <div key={h.component} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="font-medium">{h.component.replace(/_/g, " ")}</span>
              <div className="flex items-center gap-2">
                <Badge variant={h.state === "operational" ? "secondary" : "destructive"}>{h.state}</Badge>
                {isAdmin ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        health.mutate({ component: h.component as never, state: h.state === "operational" ? "degraded" : "operational" })
                      }
                    >
                      {h.state === "operational" ? (ar ? "وضع التدهور" : "Mark degraded") : ar ? "إعادة التشغيل" : "Mark operational"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border card-shadow">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{ar ? "اتساق الإجابات" : "Answer consistency"}</h3>
          <Button size="sm" onClick={() => consistency.mutate()} disabled={consistency.isPending}>
            {consistency.isPending ? (ar ? "جارٍ الفحص..." : "Checking...") : ar ? "فحص التكافؤ" : "Run equivalence check"}
          </Button>
        </header>
        <div className="divide-y">
          {(consistency.data ?? []).map((g) => (
            <div key={g.groupCode} className="px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{g.groupCode}</span>
                <Badge variant={g.consistent && g.matchRate === 100 ? "secondary" : "destructive"}>
                  {g.matchRate}% · {g.itemCount} {ar ? "صياغة" : "phrasings"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{g.description}</p>
            </div>
          ))}
          {!consistency.data ? (
            <p className="px-4 py-4 text-xs text-muted-foreground">
              {ar
                ? "يقارن صياغات مختلفة لنفس السؤال بالعربية والإنجليزية للتأكد من ثبات النتيجة."
                : "Compares different phrasings of the same question in Arabic and English to confirm a stable outcome."}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
