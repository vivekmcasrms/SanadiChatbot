/**
 * Cross-unit and per-owner performance.
 *
 * The queue answers "which case is late"; this answers "where is lateness
 * concentrated" — the view an administrator needs before changing capacity,
 * routing or expectations.
 */
import type { OwnerMonitorRow, UnitMonitorRow } from "@/lib/monitoring/monitoring.functions";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const hrs = (v: number | null | undefined, ar: boolean) =>
  v == null ? "—" : ar ? `${v.toFixed(1)} س` : `${v.toFixed(1)}h`;

export function UnitOwnerBreakdown({
  units,
  owners,
  loading,
  onUnit,
}: {
  units: UnitMonitorRow[];
  owners: OwnerMonitorRow[];
  loading: boolean;
  onUnit: (unitId: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {ar ? "الأداء حسب الوحدة" : "Performance by unit"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد بيانات" : "No data yet"}</p>
          ) : (
            units.map((u) => (
              <button
                key={u.unitId ?? "none"}
                type="button"
                disabled={!u.unitId}
                onClick={() => u.unitId && onUnit(u.unitId)}
                className="flex w-full items-center justify-between gap-3 rounded-md border p-2 text-start transition hover:border-primary/40 disabled:opacity-70"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ar ? u.unitAr : u.unitEn}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ar ? "نشطة" : "Active"} {u.active} · {ar ? "أتمتة" : "Automation"} {pct(u.automationRate)} ·{" "}
                    {ar ? "وسيط الحل" : "Median resolution"} {hrs(u.medianResolutionHours, ar)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {u.breached > 0 ? (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      {u.breached}
                    </Badge>
                  ) : null}
                  {u.responseOverdue > 0 ? (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      {u.responseOverdue}
                    </Badge>
                  ) : null}
                  {u.criticalAlerts > 0 ? (
                    <Badge className="bg-destructive text-destructive-foreground">{u.criticalAlerts}</Badge>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {ar ? "الأداء حسب المسؤول" : "Performance by responsible officer"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {owners.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد بيانات" : "No data yet"}</p>
          ) : (
            owners.map((o) => (
              <div key={`${o.ownerId}-${o.unitEn}`} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{o.ownerName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ar ? o.unitAr : o.unitEn} · {ar ? "نشطة" : "Active"} {o.activeCases} ·{" "}
                    {ar ? "وسيط الاستجابة" : "Median response"} {hrs(o.medianResponseHours, ar)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {o.overdueResponses > 0 ? (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      {ar ? "متأخر" : "Late"} {o.overdueResponses}
                    </Badge>
                  ) : null}
                  {o.slaCompliance == null ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {ar ? "لا توجد حالات منجزة" : "No completed cases"}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        o.slaCompliance >= 0.9
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : o.slaCompliance >= 0.7
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                      title={
                        ar
                          ? `ضمن المدة المحددة من ${o.closedCases} حالة منجزة`
                          : `Within SLA, of ${o.closedCases} completed case${o.closedCases === 1 ? "" : "s"}`
                      }
                    >
                      {pct(o.slaCompliance)}
                    </Badge>
                  )}

                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
