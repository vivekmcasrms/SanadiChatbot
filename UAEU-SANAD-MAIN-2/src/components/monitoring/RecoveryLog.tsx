/**
 * Recovery log: the predictable failures Sanadi met recently, what it did about
 * them, and whether a person had to step in.
 *
 * Staff-only. No technical text is shown — only the plain-language name of the
 * failure, the recovery taken, and a short trace reference for support.
 */
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { listExceptionEventsFn } from "@/lib/admin/exceptions.functions";

const RECOVERY_LABELS: Record<string, { en: string; ar: string }> = {
  retry_succeeded: { en: "Tried again and succeeded", ar: "أعيدت المحاولة ونجحت" },
  verified_fallback_used: { en: "Used verified stored information", ar: "استُخدمت معلومات محفوظة موثقة" },
  retry_then_verified_fallback: { en: "Used verified stored information", ar: "استُخدمت معلومات محفوظة موثقة" },
  unit_queue_with_admin_attention: { en: "Held in the unit queue for attention", ar: "بقي في قائمة الوحدة للمتابعة" },
  held_for_admin_unit_assignment: { en: "Waiting for an administrator to name the unit", ar: "بانتظار تحديد الوحدة من الإدارة" },
  offer_remaining_times: { en: "Offered the remaining times", ar: "عُرضت الأوقات المتبقية" },
  safe_no_answer_with_human_handoff_offer: {
    en: "safe no answer with human handoff offer",
    ar: "رد آمن دون إجابة مع عرض التحويل لموظف",
  },
  ask_clarification: { en: "ask clarification", ar: "طلب توضيح" },
};

export function RecoveryLog() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const q = useQuery({
    queryKey: ["exception-events", 14],
    queryFn: () => listExceptionEventsFn({ data: { days: 14 } }),
    retry: false,
  });

  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-base">
          {ar ? "سجل المعالجة والتعافي (١٤ يوماً)" : "Recovery log (last 14 days)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {ar
            ? "كل حالة فشل متوقعة يتم رصدها ومعالجتها تلقائياً قدر الإمكان. لا يرى الطالب أي تفاصيل تقنية."
            : "Every predictable failure is detected and recovered automatically where possible. Students never see technical detail."}
        </p>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {ar ? "تعذّر تحميل سجل التعافي." : "Could not load the recovery log."}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {ar ? "لم تُسجَّل أي حالات في هذه الفترة." : "No events recorded in this period."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {summary.map((s) => (
                <Badge key={s.code} variant="secondary" className="font-normal">
                  {ar ? s.label.ar : s.label.en}: {s.total}
                  {s.escalated > 0
                    ? ` · ${ar ? "تصعيد" : "escalated"} ${s.escalated}`
                    : ""}
                </Badge>
              ))}
            </div>

            <ul className="divide-y rounded-md border">
              {rows.slice(0, 25).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{ar ? row.label.ar : row.label.en}</span>
                  <span className="text-muted-foreground">
                    {row.recoveryAction
                      ? (RECOVERY_LABELS[row.recoveryAction]
                          ? ar
                            ? RECOVERY_LABELS[row.recoveryAction]!.ar
                            : RECOVERY_LABELS[row.recoveryAction]!.en
                          : row.recoveryAction.replace(/_/g, " "))
                      : row.recovered
                        ? ar
                          ? "تمت المعالجة"
                          : "Recovered"
                        : ar
                          ? "لم تُعالج تلقائياً"
                          : "Not recovered automatically"}
                  </span>
                  {row.escalated ? (
                    <Badge variant="outline">{ar ? "أُحيل إلى موظف" : "Escalated to a person"}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString(ar ? "ar-AE" : "en-GB")}
                    {row.traceId ? ` · ${row.traceId}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
