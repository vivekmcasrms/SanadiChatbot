/**
 * Outcome & objection card.
 *
 * When a case is resolved or closed, the student sees the result in plain
 * language — what was decided, why, who decided it, when, and what happens
 * next — and can question, correct, object to or reopen it from the same
 * place. Nothing here starts a new unrelated case.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, HelpCircle, PencilLine, ScaleIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getCaseOutcomeFn, raiseOutcomeConcernFn } from "@/lib/case-outcome.functions";
import { toastError } from "@/lib/errors/toast";
import { useI18n } from "@/lib/i18n";

type Kind = "question" | "correction" | "objection" | "reopen";

const ACTIONS: { kind: Kind; en: string; ar: string; icon: typeof HelpCircle }[] = [
  { kind: "question", en: "Ask about this result", ar: "استفسار عن النتيجة", icon: HelpCircle },
  { kind: "correction", en: "Request a correction", ar: "طلب تصحيح", icon: PencilLine },
  { kind: "objection", en: "Raise an objection", ar: "تقديم اعتراض", icon: ScaleIcon },
  { kind: "reopen", en: "Reopen request", ar: "إعادة فتح الطلب", icon: RotateCcw },
];

const PROMPT: Record<Kind, { en: string; ar: string }> = {
  question: {
    en: "What would you like to understand about this result?",
    ar: "ما الذي تود معرفته بخصوص هذه النتيجة؟",
  },
  correction: {
    en: "What is incorrect, and what should it say instead?",
    ar: "ما هو غير الصحيح، وما الذي ينبغي أن يكون؟",
  },
  objection: {
    en: "Why do you disagree with this outcome?",
    ar: "لماذا لا توافق على هذه النتيجة؟",
  },
  reopen: {
    en: "Why should this request be reopened?",
    ar: "لماذا ينبغي إعادة فتح هذا الطلب؟",
  },
};

const KIND_LABEL: Record<Kind, { en: string; ar: string }> = {
  question: { en: "Question about the result", ar: "استفسار عن النتيجة" },
  correction: { en: "Correction requested", ar: "طلب تصحيح" },
  objection: { en: "Objection raised", ar: "اعتراض مقدَّم" },
  reopen: { en: "Reopen requested", ar: "طلب إعادة فتح" },
};

const DECISION_LABEL: Record<string, { en: string; ar: string }> = {
  approved: { en: "Accepted after review", ar: "قُبل بعد المراجعة" },
  rejected: { en: "Original outcome confirmed", ar: "تم تأكيد النتيجة الأصلية" },
};

export function CaseOutcomeCard({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [open, setOpen] = useState<Kind | null>(null);
  const [text, setText] = useState("");

  const outcomeQuery = useQuery({
    queryKey: ["case-outcome", caseId],
    queryFn: () => getCaseOutcomeFn({ data: { caseId } }),
  });

  const submit = useMutation({
    mutationFn: (kind: Kind) => raiseOutcomeConcernFn({ data: { caseId, kind, reason: text.trim(), lang: ar ? "ar" : "en" } }),
    onSuccess: (_r, kind) => {
      setOpen(null);
      setText("");
      toast.success(
        kind === "question"
          ? ar
            ? "تم إرسال استفسارك إلى الوحدة المسؤولة."
            : "Your question was sent to the responsible unit."
          : ar
            ? "تم تسجيل طلبك وأصبح الطلب قيد المراجعة."
            : "Recorded — your request is now under review.",
      );
      void qc.invalidateQueries({ queryKey: ["case-outcome", caseId] });
      void qc.invalidateQueries({ queryKey: ["case-activity", caseId] });
      void qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (e) => toastError(e, lang),
  });

  const d = outcomeQuery.data;
  if (!d) return null;
  const resolved = d.status === "resolved" || d.status === "closed" || Boolean(d.outcomeEn);
  if (!resolved) return null;

  const outcome = (ar ? d.outcomeAr || d.outcomeEn : d.outcomeEn) ?? (ar ? "تم إنهاء الطلب." : "Your request was completed.");
  const explanation = ar ? d.explanationAr || d.explanationEn : d.explanationEn;
  const unit = (ar ? d.unitAr : d.unitEn) ?? "—";
  const nextStep = ar ? d.nextStepAr || d.nextStepEn : d.nextStepEn;
  const decided = d.resolvedAt
    ? new Date(d.resolvedAt).toLocaleString(ar ? "ar-AE" : "en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  const rows: { label: string; value: string }[] = [
    { label: ar ? "الوحدة المسؤولة" : "Responsible unit", value: unit },
    { label: ar ? "الموظف المسؤول" : "Responsible staff member", value: d.staffName ?? (ar ? "فريق الوحدة" : "Unit team") },
    { label: ar ? "تاريخ الإنهاء" : "Resolution date", value: decided },
  ];
  if (nextStep) rows.push({ label: ar ? "الخطوة التالية" : "Next step", value: nextStep });

  return (
    <section className="rounded-2xl border border-success/40 bg-success/5 p-5" dir={ar ? "rtl" : "ltr"}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-success">
        <CheckCircle2 className="size-4" aria-hidden />
        {ar ? "نتيجة طلبك" : "Your result"}
      </h2>

      <p className="mt-3 text-base font-medium text-foreground">{outcome}</p>
      {explanation ? <p className="mt-2 text-sm text-muted-foreground">{explanation}</p> : null}

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="text-sm font-medium text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>

      {/* Everything below continues inside this same case. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.kind}
            size="sm"
            variant={open === a.kind ? "default" : "outline"}
            onClick={() => {
              setOpen(open === a.kind ? null : a.kind);
              setText("");
            }}
          >
            <a.icon className="size-4" aria-hidden /> {ar ? a.ar : a.en}
          </Button>
        ))}
      </div>

      {open ? (
        <div className="mt-3 rounded-xl border bg-card p-4">
          <label className="text-sm font-medium" htmlFor="outcome-concern">
            {ar ? PROMPT[open].ar : PROMPT[open].en}
          </label>
          <Textarea
            id="outcome-concern"
            className="mt-2"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={submit.isPending || text.trim().length < 5}
              onClick={() => submit.mutate(open)}
            >
              {ar ? "إرسال" : "Send"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </div>
          {open === "objection" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {ar
                ? "تُحفظ النتيجة الأصلية كما هي، ويُحال اعتراضك إلى جهة مراجعة مخوّلة."
                : "The original outcome is kept as it is, and your objection goes to an authorised reviewer."}
            </p>
          ) : null}
        </div>
      ) : null}

      {d.concerns.length ? (
        <div className="mt-5 border-t pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ar ? "سجل الاعتراضات والمراجعات" : "Objection and review history"}
          </h3>
          <ol className="mt-3 space-y-3">
            {d.concerns.map((c) => (
              <li key={c.id} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{ar ? KIND_LABEL[c.kind].ar : KIND_LABEL[c.kind].en}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString(ar ? "ar-AE" : "en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{c.reason}</p>
                {c.originalOutcomeEn || c.originalOutcomeAr ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium">{ar ? "النتيجة الأصلية: " : "Original outcome: "}</span>
                    {ar ? c.originalOutcomeAr || c.originalOutcomeEn : c.originalOutcomeEn}
                  </p>
                ) : null}
                {c.decision ? (
                  <p className="mt-2 text-xs">
                    <span className="font-medium">
                      {(ar ? DECISION_LABEL[c.decision]?.ar : DECISION_LABEL[c.decision]?.en) ?? c.decision}
                    </span>
                    {c.decisionReason ? ` — ${c.decisionReason}` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ar ? "قيد المراجعة" : "Under review"}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
