/** Student-facing "What Sanadi Did": plain sentences, never technical logs. */
import { useQuery } from "@tanstack/react-query";
import { Bot, User, UserCheck } from "lucide-react";
import { getCaseActivityFn } from "@/lib/case-activity.functions";
import { useI18n } from "@/lib/i18n";

const ICON = { sanadi: Bot, staff: UserCheck, you: User } as const;

export function CaseActivityTimeline({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const query = useQuery({
    queryKey: ["case-activity", caseId],
    queryFn: () => getCaseActivityFn({ data: { caseId } }),
  });

  return (
    <section className="rounded-2xl border bg-card p-5 card-shadow">
      <h2 className="text-sm font-semibold">{ar ? "ما الذي قام به سند" : "What Sanadi Did"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {ar
          ? "ملخص مبسّط لكل خطوة تمت على طلبك، ومن قام بها ونتيجتها."
          : "A plain-language summary of every step taken on your request, who handled it and the result."}
      </p>
      {query.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : query.data?.length ? (
        <ol className="mt-4 space-y-3">
          {query.data.map((event, index) => {
            const Icon = ICON[event.by];
            const actor = ar ? event.actorAr : event.actorEn;
            const result = ar ? event.resultAr : event.resultEn;
            return (
              <li key={`${event.at}-${index}`} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 rounded-full border bg-surface p-1.5">
                  <Icon className="size-3.5 text-primary" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{ar ? event.ar : event.en}</p>
                    {result ? (
                      <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {result}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString(ar ? "ar-AE" : "en-GB")}
                    {actor ? ` — ${actor}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{ar ? "لا يوجد بعد" : "Nothing yet"}</p>
      )}
    </section>
  );
}
