/**
 * Voice Interaction evidence: usage metrics from saved transcript details and
 * an admin-run test that speaks each scenario through the real pipeline.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Mic, PlayCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { getVoiceMetrics, runVoiceEvaluation } from "@/lib/voice.functions";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function VoiceEvidencePanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const load = useServerFn(getVoiceMetrics);
  const run = useServerFn(runVoiceEvaluation);
  const metrics = useQuery({ queryKey: ["voice-metrics"], queryFn: () => load() });
  const test = useMutation({ mutationFn: () => run() });
  const m = metrics.data;
  const results = test.data?.results ?? [];
  const passed = results.filter((r) => r.passed).length;

  return (
    <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Mic className="size-4" aria-hidden />
          {ar ? "التفاعل الصوتي" : "Voice Interaction"}
        </h2>
        {results.length ? (
          <Badge variant={passed === results.length ? "default" : "secondary"}>
            {passed}/{results.length} {ar ? "ناجح" : "passed"}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={ar ? "تفاعلات صوتية" : "Voice interactions"} value={String(m?.total ?? "—")} />
        <Stat label={ar ? "عربي / إنجليزي" : "Arabic / English"} value={m ? `${m.arabic} / ${m.english}` : "—"} />
        <Stat label={ar ? "نجاح التحويل" : "Transcription success"} value={m ? `${m.transcriptionSuccessRate}%` : "—"} />
        <Stat label={ar ? "نسبة التوضيح" : "Clarification rate"} value={m ? `${m.clarificationRate}%` : "—"} />
        <Stat label={ar ? "إتمام الإجراءات" : "Voice-to-action completion"} value={m ? `${m.actionCompletionRate}%` : "—"} />
        <Stat label={ar ? "أعطال الخدمة" : "Speech service failures"} value={m ? `${m.failures} (${m.failureRate}%)` : "—"} />
      </div>

      <div className="space-y-2">
        <Button size="sm" className="gap-1" disabled={test.isPending} onClick={() => test.mutate()}>
          <PlayCircle className="size-4" aria-hidden />
          {test.isPending ? (ar ? "جارٍ التشغيل…" : "Running…") : ar ? "تشغيل اختبارات الصوت" : "Run voice tests"}
        </Button>
        {test.isError ? (
          <p className="text-xs text-destructive">{ar ? "تعذّر تشغيل الاختبارات." : "The tests could not run."}</p>
        ) : null}
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.key} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {r.passed ? (
                  <CheckCircle2 className="size-4 text-primary" aria-hidden />
                ) : (
                  <XCircle className="size-4 text-destructive" aria-hidden />
                )}
                {r.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                {ar ? "المنطوق: " : "Spoken: "}
                {r.spoken}
              </p>
              {r.transcript ? (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {ar ? "النص: " : "Transcript: "}
                  {r.transcript}
                </p>
              ) : null}
              <p className="text-xs">
                {ar ? "المتوقع: " : "Expected: "}
                {r.expected} — {r.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
