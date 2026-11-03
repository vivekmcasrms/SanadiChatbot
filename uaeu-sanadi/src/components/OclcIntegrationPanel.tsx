import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CheckCircle2, CircleSlash, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOclcDiagnostics, runOclcTestSearch } from "@/lib/library.functions";

type Status = "healthy" | "failed" | "not_configured";

const StatusIcon = ({ status }: { status: Status }) =>
  status === "healthy" ? (
    <CheckCircle2 className="size-4 text-primary" aria-hidden />
  ) : status === "failed" ? (
    <XCircle className="size-4 text-destructive" aria-hidden />
  ) : (
    <CircleSlash className="size-4 text-muted-foreground" aria-hidden />
  );

/** Admin diagnostics for the OCLC WorldCat integration. Shows no credentials. */
export function OclcIntegrationPanel({ ar }: { ar: boolean }) {
  const diagnosticsFn = useServerFn(getOclcDiagnostics);
  const testSearchFn = useServerFn(runOclcTestSearch);
  const [query, setQuery] = useState("machine learning");

  const diagnostics = useMutation({ mutationFn: () => diagnosticsFn({}) });
  const testSearch = useMutation({ mutationFn: () => testSearchFn({ data: { query } }) });

  const d = diagnostics.data;
  const s = testSearch.data;

  return (
    <section className="rounded-lg border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Activity className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">{ar ? "تشخيص تكامل OCLC" : "OCLC integration diagnostics"}</h3>
        {d ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {ar ? "المؤسسة" : "Institution"} {d.institutionId ?? "—"}
          </span>
        ) : null}
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        {ar
          ? "تُقرأ بيانات اعتماد OCLC من أسرار الخادم ولا تظهر هنا مطلقاً."
          : "OCLC credentials are read from server secrets and are never displayed here."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={diagnostics.isPending} onClick={() => diagnostics.mutate()}>
          {ar ? "فحص الاتصال" : "Run connection check"}
        </Button>
        <div className="flex flex-1 min-w-[220px] gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ar ? "استعلام تجريبي" : "Test query"} />
          <Button size="sm" variant="outline" disabled={testSearch.isPending} onClick={() => testSearch.mutate()}>
            <Search className="size-4" aria-hidden />
            {ar ? "بحث تجريبي" : "Test search"}
          </Button>
        </div>
      </div>

      {diagnostics.error ? (
        <p className="mt-3 text-xs text-destructive">{(diagnostics.error as Error).message}</p>
      ) : null}

      {d ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            {ar ? "الصلاحيات" : "Scopes"}: {d.scopes ?? "—"} ·{" "}
            {d.tokenCached
              ? `${ar ? "الرمز مخزّن حتى" : "Token cached until"} ${new Date(d.tokenExpiresAt ?? "").toLocaleTimeString()}`
              : ar
                ? "لا يوجد رمز مخزّن"
                : "No cached token"}
          </div>
          <ul className="divide-y rounded-md border text-sm">
            {d.services.map((svc) => (
              <li key={svc.key} className="flex items-start gap-2 p-2">
                <StatusIcon status={svc.status as Status} />
                <div className="min-w-0">
                  <p className="font-medium">{svc.label}</p>
                  {svc.detail ? <p className="text-xs text-muted-foreground break-words">{svc.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          {d.health.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-1 text-start">{ar ? "الخدمة" : "Service"}</th>
                    <th className="p-1 text-start">{ar ? "الطلبات" : "Calls"}</th>
                    <th className="p-1 text-start">{ar ? "الإخفاقات" : "Failures"}</th>
                    <th className="p-1 text-start">{ar ? "المتوسط" : "Avg"}</th>
                    <th className="p-1 text-start">429</th>
                  </tr>
                </thead>
                <tbody>
                  {d.health.map((h) => (
                    <tr key={h.service} className="border-t">
                      <td className="p-1">{h.service}</td>
                      <td className="p-1">{h.calls}</td>
                      <td className="p-1">{h.failures}</td>
                      <td className="p-1">{h.avgLatencyMs ?? "—"} ms</td>
                      <td className="p-1">{h.rateLimitEvents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {s ? (
        <div className="mt-4 rounded-md border p-3 text-xs">
          <p className="font-medium">
            {ar ? "نتيجة البحث التجريبي" : "Test search result"} · {s.status} · {s.latencyMs} ms
          </p>
          <p className="mt-1 text-muted-foreground">
            {ar ? "نتائج" : "Results"}: {s.resultsReturned} · {ar ? "لدى جامعة الإمارات" : "Held by UAEU"}: {s.localHoldings} ·{" "}
            {ar ? "توافر محسوم" : "Availability resolved"}: {s.availabilityResolved} · {ar ? "وصول إلكتروني" : "Electronic"}:{" "}
            {s.electronicAccess}
          </p>
          {s.error ? <p className="mt-1 text-destructive">{s.error}</p> : null}
          <ul className="mt-2 space-y-1">
            {s.sample.map((row, i) => (
              <li key={i} className="truncate">
                {row.title} {row.year ? `(${row.year})` : ""} — {row.type} · {row.scope}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
