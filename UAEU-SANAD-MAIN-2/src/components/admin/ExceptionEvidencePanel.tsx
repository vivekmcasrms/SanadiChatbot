/**
 * Exceptions evidence for the Acceptance Verification page.
 *
 * Shows what was actually recorded — detected, recovered, recovery rate and the
 * latest controlled tests with their pass/fail result — and lets an admin run a
 * safe exception scenario that exercises the real detection and recovery code.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, PlayCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { getExceptionEvidenceFn, runExceptionTestFn } from "@/lib/admin/exceptions.functions";

const SCENARIOS = [
  { code: "ambiguous_request", en: "Ambiguous request", ar: "طلب غامض" },
  { code: "api_timeout", en: "Simulated service timeout", ar: "تعذّر استجابة خدمة" },
  { code: "staff_unavailable", en: "Staff unavailable", ar: "لا يوجد موظف متاح" },
  { code: "missing_knowledge", en: "Missing knowledge", ar: "لا توجد معلومة معتمدة" },
] as const;

type Scenario = (typeof SCENARIOS)[number]["code"];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function ExceptionEvidencePanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();

  const evidence = useQuery({
    queryKey: ["exception-evidence"],
    queryFn: getExceptionEvidenceFn,
  });

  const test = useMutation({
    mutationFn: (scenario: Scenario) => runExceptionTestFn({ data: { scenario, language: lang } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["exception-evidence"] }),
  });

  const data = evidence.data;
  const complete = Boolean(data && data.detected > 0 && data.recovered > 0);

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {ar ? "أدلة الاستثناءات والتعافي" : "Exception detection and recovery evidence"}
        </h3>
        <Badge variant={complete ? "default" : "secondary"}>
          {complete ? (ar ? "مكتمل" : "Complete") : ar ? "بانتظار دليل" : "Evidence needed"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={ar ? "تم اكتشافها" : "Detected"} value={String(data?.detected ?? "—")} />
        <Stat label={ar ? "تمت معالجتها" : "Recovered"} value={String(data?.recovered ?? "—")} />
        <Stat
          label={ar ? "نسبة التعافي" : "Recovery rate"}
          value={data ? `${data.recoveryRate}%` : "—"}
        />
        <Stat
          label={ar ? "اختبارات مضبوطة" : "Controlled tests"}
          value={String(data?.controlledTests ?? "—")}
        />
      </div>

      <div>
        <p className="text-xs font-medium">{ar ? "تشغيل اختبار استثناء" : "Run Exception Test"}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {ar
            ? "اختبارات آمنة تستخدم منطق الاكتشاف والتعافي الحقيقي ولا تمس بيانات الطلبة أو الطلبات."
            : "Safe tests that drive the real detection and recovery code. They never touch student, case, staff or document data."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <Button
              key={s.code}
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={test.isPending}
              onClick={() => test.mutate(s.code)}
            >
              <PlayCircle className="size-3.5" aria-hidden />
              {ar ? s.ar : s.en}
            </Button>
          ))}
        </div>
        {test.isError ? (
          <p className="mt-2 text-xs text-destructive">
            {ar ? "تعذّر تشغيل الاختبار." : "The test could not be run."}
          </p>
        ) : null}
        {test.data ? (
          <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{test.data.label[ar ? "ar" : "en"]}</span>
              {test.data.pass ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
                  <CheckCircle2 className="size-3" aria-hidden /> PASS
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                  <XCircle className="size-3" aria-hidden /> FAIL
                </span>
              )}
              <span className="text-muted-foreground">{test.data.traceId}</span>
            </div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>
                {ar ? "النوع: " : "Exception: "}
                {test.data.code}
              </li>
              <li>
                {ar ? "تم الاكتشاف: " : "Detected: "}
                {test.data.detected ? (ar ? "نعم" : "Yes") : ar ? "لا" : "No"}
              </li>
              <li>
                {ar ? "إجراء التعافي: " : "Recovery: "}
                {test.data.recoveryAction}
              </li>
              <li>
                {ar ? "تمت المعالجة: " : "Recovered: "}
                {test.data.recovered ? (ar ? "نعم" : "Yes") : ar ? "لا" : "No"}
                {test.data.escalated ? (ar ? " · تم التصعيد" : " · escalated") : ""}
              </li>
              {test.data.studentMessage ? (
                <li>
                  {ar ? "ما يراه الطالب: " : "Student sees: "}
                  <span className="italic">{test.data.studentMessage}</span>
                </li>
              ) : null}
              <li>{test.data.note[ar ? "ar" : "en"]}</li>
            </ul>
          </div>
        ) : null}
      </div>

      <div>
        <p className="text-xs font-medium">{ar ? "آخر اختبارات الاستثناءات" : "Latest exception tests"}</p>
        {!data?.latestTests.length ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {ar ? "لم يتم تشغيل أي اختبار بعد." : "No controlled test has been run yet."}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {data.latestTests.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 px-2 py-1 text-xs">
                <span className="font-medium">{t.label[ar ? "ar" : "en"]}</span>
                <span className="text-muted-foreground">{t.recoveryAction ?? "—"}</span>
                <span
                  className={
                    t.recovered
                      ? "rounded-full bg-success/10 px-2 py-0.5 text-success"
                      : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"
                  }
                >
                  {t.recovered ? "PASS" : "FAIL"}
                </span>
                {t.escalated ? (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3" aria-hidden />
                    {ar ? "تم التصعيد" : "escalated"}
                  </span>
                ) : null}
                <span className="ms-auto text-muted-foreground">
                  {new Date(t.createdAt).toLocaleString(ar ? "ar-AE" : "en-GB")}
                </span>
                {t.traceId ? <span className="text-muted-foreground">{t.traceId}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data?.byCode.length ? (
        <div>
          <p className="text-xs font-medium">{ar ? "حسب نوع الاستثناء" : "By exception type"}</p>
          <ul className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {data.byCode.map((c) => (
              <li key={c.code} className="rounded border px-2 py-0.5">
                {c.label[ar ? "ar" : "en"]}: {c.recovered}/{c.total}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
