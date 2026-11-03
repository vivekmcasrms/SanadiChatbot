import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { CaseResultCard as CaseResultCardData } from "@/lib/agent-types";

/**
 * The outcome of a student's request, shown inside the chat with the three
 * follow-up actions. Each action continues the conversation on the SAME
 * request — it never starts a new one.
 */
export function CaseResultCard({
  card,
  lang,
  onDraft,
}: {
  card: CaseResultCardData;
  lang: "en" | "ar";
  /** Pre-fills the chat box so the student finishes the sentence in their own words. */
  onDraft: (message: string) => void;
}) {
  const ar = lang === "ar";
  const date = card.decidedAt
    ? new Date(card.decidedAt).toLocaleDateString(ar ? "ar-AE" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const rows: { label: string; value: string }[] = [];
  if (date) rows.push({ label: ar ? "التاريخ" : "Date", value: date });

  // The same "who is following this up" block on every kind of request:
  // the named person when one is assigned, the unit and a waiting note when
  // nobody has been named yet. Nothing is invented.
  const followUp: { label: string; value: string }[] = card.staffName
    ? [
        { label: ar ? "الموظف المسؤول" : "Responsible staff member", value: card.staffName },
        ...(card.unitName ? [{ label: ar ? "الوحدة" : "Unit", value: card.unitName }] : []),
        ...(card.staffEmail
          ? [{ label: ar ? "البريد الجامعي" : "University email", value: card.staffEmail }]
          : []),
        { label: ar ? "رقم الطلب" : "Reference", value: card.reference },
      ]
    : card.unitName
      ? [
          { label: ar ? "الجهة المسؤولة" : "Responsible unit", value: card.unitName },
          {
            label: ar ? "الحالة" : "Status",
            value: ar
              ? "تم استلام طلبك لدى الجهة المختصة وهو بانتظار تعيين الموظف المسؤول."
              : "Your request has been received by the unit and is awaiting staff assignment.",
          },
          { label: ar ? "رقم الطلب" : "Reference", value: card.reference },
        ]
      : [];


  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm" dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{card.title}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{card.statusLabel}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{card.reference}</p>

      {card.outcome ? (
        <p className="mt-3 whitespace-pre-line">
          <span className="font-medium">{ar ? "النتيجة: " : "Outcome: "}</span>
          {card.outcome}
        </p>
      ) : null}
      {card.explanation ? <p className="mt-2 text-muted-foreground">{card.explanation}</p> : null}

      {rows.length ? (
        <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-2">
              <dt className="min-w-28 font-medium">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {followUp.length ? (
        <div className="mt-3 rounded-lg border border-border/70 bg-muted/40 p-3">
          <p className="text-xs font-semibold">
            {ar ? "الشخص المسؤول عن متابعة طلبك" : "Who is following up your request"}
          </p>
          <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
            {followUp.map((r) => (
              <div key={r.label} className="flex gap-2">
                <dt className="min-w-28 font-medium">{r.label}</dt>
                <dd className="break-all">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}



      {card.nextSteps.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium">{ar ? "الخطوات التالية" : "Next steps"}</p>
          <ul className="mt-1 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
            {card.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.reviewState ? (
        <p className="mt-3 rounded-lg bg-muted/60 p-2 text-xs">
          {ar
            ? "تم تسجيل متابعتك على هذا الطلب، والقرار الأصلي محفوظ. ستصلك النتيجة بعد المراجعة."
            : "Your follow-up is recorded on this request and the original decision is kept on file. You will be informed once it has been reviewed."}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onDraft(
              ar
                ? `لدي سؤال عن نتيجة الطلب ${card.reference}: `
                : `I have a question about the result of request ${card.reference}: `,
            )
          }
        >
          {ar ? "استفسار عن النتيجة" : "Ask about this result"}
        </Button>
        {card.canObject && !card.reviewState ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onDraft(
                  ar
                    ? `أطلب تصحيح نتيجة الطلب ${card.reference} لأن `
                    : `I would like to request a correction on request ${card.reference} because `,
                )
              }
            >
              {ar ? "طلب تصحيح" : "Request a correction"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onDraft(
                  ar
                    ? `أعترض على نتيجة الطلب ${card.reference} لأن `
                    : `I disagree with the result of request ${card.reference} because `,
                )
              }
            >
              {ar ? "تقديم اعتراض" : "Raise an objection"}
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" asChild>
          <Link to="/requests/$caseId" params={{ caseId: card.caseId }}>
            {ar ? "عرض الطلب" : "View request"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
