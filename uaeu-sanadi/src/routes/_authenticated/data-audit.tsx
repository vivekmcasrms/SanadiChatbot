import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getDataClassificationAudit } from "@/lib/data-audit.functions";

export const Route = createFileRoute("/_authenticated/data-audit")({
  head: () => ({
    meta: [
      { title: "Data Classification Audit — Sanadi | UAEU" },
      { name: "description", content: "Counts of real and demo records and any links between them, for Sanadi administrators." },
      { property: "og:title", content: "Data Classification Audit — Sanadi | UAEU" },
      { property: "og:description", content: "Real versus demo record report for Sanadi administrators." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataAuditPage,
});

const CROSS_LABELS: Record<string, { en: string; ar: string }> = {
  realStudentDemoProfileFlag: { en: "Real accounts flagged as demo students", ar: "حسابات حقيقية مصنفة كطلاب تجريبيين" },
  realCasesWithDemoStudent: { en: "Real cases owned by demo students", ar: "حالات حقيقية لطلاب تجريبيين" },
  demoCasesWithRealStudent: { en: "Demo cases owned by real students", ar: "حالات تجريبية لطلاب حقيقيين" },
  realCasesAssignedToDemoStaff: { en: "Real cases assigned to demo staff", ar: "حالات حقيقية مسندة لموظفين تجريبيين" },
  realStudentsInDemoRooms: { en: "Real students booked into demo rooms", ar: "طلاب حقيقيون في غرف تجريبية" },
  demoRoomsInRealHostels: { en: "Rooms classified differently from their hostel", ar: "غرف بتصنيف يختلف عن السكن" },
};

function DataAuditPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const q = useQuery({ queryKey: ["data-audit"], queryFn: () => getDataClassificationAudit() });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{ar ? "تدقيق تصنيف البيانات" : "Data Classification Audit"}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "تقرير للقراءة فقط. لا يحذف أو يغيّر أي سجل."
              : "Read-only report. Nothing is deleted or changed."}
          </p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {ar ? "تحديث" : "Refresh"}
        </Button>
      </div>

      {q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : null}

      {q.data ? (
        <>
          <section className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-start">
                <tr>
                  <th className="p-2 text-start">{ar ? "المجال" : "Area"}</th>
                  <th className="p-2 text-end">{ar ? "حقيقي" : "Real"}</th>
                  <th className="p-2 text-end">{ar ? "تجريبي" : "Demo"}</th>
                  <th className="p-2 text-end">{ar ? "غير مصنف" : "Unclassified"}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.counts.map((c) => (
                  <tr key={c.area} className="border-t">
                    <td className="p-2 font-mono text-xs">{c.area}</td>
                    <td className="p-2 text-end">{c.real}</td>
                    <td className="p-2 text-end">{c.demo > 0 ? <Badge variant="secondary">{c.demo}</Badge> : 0}</td>
                    <td className="p-2 text-end">{c.unclassified > 0 ? <Badge variant="destructive">{c.unclassified}</Badge> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{ar ? "روابط بين الحقيقي والتجريبي" : "Links between real and demo records"}</h2>
            <ul className="divide-y rounded-xl border">
              {Object.entries(q.data.crossReferences).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between p-3 text-sm">
                  <span>{ar ? (CROSS_LABELS[k]?.ar ?? k) : (CROSS_LABELS[k]?.en ?? k)}</span>
                  {v > 0 ? <Badge variant="destructive">{v}</Badge> : <Badge variant="outline">0</Badge>}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
