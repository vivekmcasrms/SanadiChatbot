/** The handover package a staff member reads before touching the case. */
import { useQuery } from "@tanstack/react-query";
import { getCaseHandoverFn } from "@/lib/handover.functions";
import { useI18n } from "@/lib/i18n";

const FIELD_LABEL: Record<string, { en: string; ar: string }> = {
  programme: { en: "Programme", ar: "البرنامج" },
  college: { en: "College", ar: "الكلية" },
  academic_level: { en: "Level", ar: "المستوى" },
  completed_credit_hours: { en: "Completed credits", ar: "الساعات المكتملة" },
  cumulative_gpa: { en: "GPA", ar: "المعدل التراكمي" },
  expected_graduation_date: { en: "Expected graduation", ar: "التخرج المتوقع" },
  preferred_language: { en: "Language", ar: "اللغة" },
};

export function HandoverPackageCard({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const query = useQuery({
    queryKey: ["case-handover", caseId],
    queryFn: () => getCaseHandoverFn({ data: { caseId } }),
  });

  if (query.isLoading || !query.data) return null;
  const h = query.data;

  return (
    <section className="rounded-2xl border bg-card p-5 card-shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{ar ? "ملف التسليم" : "Handover package"}</h2>
        {h.priority ? (
          <span className="rounded-full border px-2 py-0.5 text-xs capitalize">
            {ar ? "الأولوية" : "Priority"}: {h.priority}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {ar
          ? "كل ما يحتاجه الموظف — لا داعي لسؤال الطالب عن معلومات سبق أن قدّمها."
          : "Everything already known — the student should not be asked to repeat any of it."}
      </p>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{ar ? "الطالب" : "Student"}</dt>
          <dd className="font-medium">
            {h.studentName ?? "—"} {h.studentNumber ? `· ${h.studentNumber}` : ""}
          </dd>
          <dd className="text-muted-foreground">{h.studentEmail}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{ar ? "الوحدة" : "Unit"}</dt>
          <dd className="font-medium">{(ar ? h.unitAr : h.unitEn) ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{ar ? "نوع التفاعل" : "Interaction type"}</dt>
          <dd className="font-medium capitalize">{h.interactionType?.replace(/_/g, " ") ?? "—"}</dd>
        </div>
      </dl>

      {h.summary ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{ar ? "الملخص" : "Summary"}</p>
          <p className="text-sm">{h.summary}</p>
        </div>
      ) : null}

      {Object.keys(h.verifiedData).length ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{ar ? "بيانات موثقة مستخدمة" : "Verified data used"}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(h.verifiedData)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => (
                <span key={k} className="rounded-full border bg-surface px-2 py-0.5 text-xs">
                  {(FIELD_LABEL[k]?.[ar ? "ar" : "en"] ?? k.replace(/_/g, " "))}: {String(v)}
                </span>
              ))}
          </div>
        </div>
      ) : null}

      {h.actionsTaken.length ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{ar ? "ما تم تنفيذه بالفعل" : "Already performed"}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {h.actionsTaken.map((a, i) => (
              <li key={`${a.what}-${i}`} className="capitalize">
                {a.what}
                {a.reference ? <span className="text-muted-foreground"> · {a.reference}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">{ar ? "المشكلة غير المحلولة" : "Unresolved issue"}</p>
          <p className="text-sm">{h.unresolvedIssue ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{ar ? "الإجراء الموصى به" : "Recommended next action"}</p>
          <p className="text-sm">{h.recommendedAction ?? "—"}</p>
        </div>
      </div>

      {h.attachments.length ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{ar ? "المرفقات" : "Attachments"}</p>
          <ul className="mt-1 text-sm">
            {h.attachments.map((a, i) => (
              <li key={`${a.label}-${i}`}>{a.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {h.conversation.length ? (
        <details className="mt-4 rounded-lg border bg-surface p-3">
          <summary className="cursor-pointer text-xs font-medium">
            {ar ? "سياق المحادثة ذي الصلة" : "Relevant conversation context"}
          </summary>
          <ol className="mt-2 space-y-2 text-sm">
            {h.conversation.map((turn, i) => (
              <li key={`${turn.at}-${i}`}>
                <span className="text-xs font-medium text-primary">
                  {turn.role === "student" ? (ar ? "الطالب" : "Student") : "Sanadi"}:
                </span>{" "}
                {turn.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
