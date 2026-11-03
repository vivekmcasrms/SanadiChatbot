import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/auth-token";
import { useI18n } from "@/lib/i18n";
import {
  provideInformationFn,
  
  respondToResolutionFn,
  submitCaseFeedbackFn,
} from "@/lib/case-ops.functions";

export function StudentCasePanel({ caseId, status }: { caseId: string; status: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [comment, setComment] = useState("");
  
  const [feedbackComment, setFeedbackComment] = useState("");

  const q = useQuery({
    queryKey: ["student-case-panel", caseId],
    queryFn: async () => {
      const [infoReqs, resolutions, feedback] = await Promise.all([
        apiFetch<{ id: string; information_required: string; due_at: string | null; status: string }[]>(`/api/v1/data/case_information_requests?select=id,information_required,due_at,status&case_id=eq.${caseId}&status=eq.pending`),
        apiFetch<{ id: string; resolution_summary_en: string | null; resolution_summary_ar: string | null; compensation_or_remedy: string | null; student_response: string | null; proposed_to_student_at: string | null }[]>(`/api/v1/data/case_resolutions?select=id,resolution_summary_en,resolution_summary_ar,compensation_or_remedy,student_response,proposed_to_student_at&case_id=eq.${caseId}&proposed_to_student_at=not.is.null&order=created_at.desc`),
        apiFetch<{ id: string; overall_satisfaction: number | null }[]>(`/api/v1/data/case_feedback?select=id,overall_satisfaction&case_id=eq.${caseId}&limit=1`),
      ]);
      return {
        infoRequests: infoReqs,
        resolution: resolutions[0] ?? null,
        feedback: feedback[0] ?? null,
      };
    },
  });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(ar ? "تم" : "Done");
      void qc.invalidateQueries({ queryKey: ["student-case-panel", caseId] });
      void qc.invalidateQueries({ queryKey: ["case", caseId] });
      void qc.invalidateQueries({ queryKey: ["case-timeline", caseId] });
    } catch (e) {
      toastError(e, lang);
    } finally {
      setBusy(false);
    }
  }

  const pending = q.data?.infoRequests ?? [];
  const resolution = q.data?.resolution;
  const closed = status === "closed" || status === "resolved";

  return (
    <div className="space-y-4">
      {pending.length ? (
        <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="text-sm font-semibold">{ar ? "مطلوب منك معلومات" : "Information needed from you"}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pending.map((r) => (
              <li key={r.id}>
                {r.information_required}
                {r.due_at ? ` — ${ar ? "قبل" : "by"} ${new Date(r.due_at).toLocaleDateString()}` : ""}
              </li>
            ))}
          </ul>
          <Textarea
            className="mt-3"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={ar ? "اكتب ردك" : "Write your response"}
          />
          <Button
            className="mt-2"
            size="sm"
            disabled={busy || answer.trim().length < 2}
            onClick={() =>
              act(() =>
                provideInformationFn({
                  data: { caseId, responseNote: answer.trim(), requestId: pending[0]?.id ?? null },
                }).then(() => setAnswer("")),
              )
            }
          >
            {ar ? "إرسال المعلومات" : "Send information"}
          </Button>
        </section>
      ) : null}

      {resolution && !resolution.student_response ? (
        <section className="rounded-2xl border bg-card p-5 card-shadow">
          <h2 className="text-sm font-semibold">{ar ? "الحل المقترح" : "Proposed resolution"}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {(ar && resolution.resolution_summary_ar) || resolution.resolution_summary_en}
          </p>
          {resolution.compensation_or_remedy ? (
            <p className="mt-2 text-sm text-muted-foreground">{resolution.compensation_or_remedy}</p>
          ) : null}
          <Textarea
            className="mt-3"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={ar ? "تعليق اختياري" : "Optional comment"}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(() => respondToResolutionFn({ data: { caseId, accept: true, comment: comment.trim() || undefined } }))
              }
            >
              {ar ? "قبول الحل" : "Accept resolution"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                act(() =>
                  respondToResolutionFn({ data: { caseId, accept: false, comment: comment.trim() || undefined } }),
                )
              }
            >
              {ar ? "غير مقبول" : "Not resolved yet"}
            </Button>
          </div>
        </section>
      ) : null}

      {closed && !q.data?.feedback ? (
        <section className="rounded-2xl border bg-card p-5 card-shadow">
          <h2 className="text-sm font-semibold">{ar ? "قيّم الخدمة" : "Rate the service"}</h2>
          <Textarea
            className="mt-3"
            rows={2}
            value={feedbackComment}
            onChange={(e) => setFeedbackComment(e.target.value)}
            placeholder={ar ? "ملاحظاتك (اختياري)" : "Your comments (optional)"}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((v) => (
              <Button
                key={v}
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`${v}`}
                onClick={() =>
                  act(() =>
                    submitCaseFeedbackFn({
                      data: { caseId, overall: v, comments: feedbackComment.trim() || undefined },
                    }),
                  )
                }
              >
                <Star className="size-4" aria-hidden /> {v}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Reopening now lives on the outcome card, next to the result itself. */}
    </div>
  );
}
