/**
 * The operational queue.
 *
 * One row = one accountable case. Columns answer, left to right: what is it,
 * who owns it now, how long have they had it, and how close is it to breaching.
 * Sorting, filtering and paging all happen in Postgres, so this table stays the
 * same speed whether the university has 200 open cases or 200,000.
 */
import { AlertTriangle, ArrowUpRight, Clock, Flame, TimerOff } from "lucide-react";
import type { MonitorRow } from "@/lib/monitoring/monitoring.functions";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ListEmpty } from "@/components/list/ListControls";
import { SLA_LABEL, actorText, duration, slaClasses, typeText } from "./monitoring-format";

export function MonitoringTable({
  rows,
  loading,
  onOpen,
}: {
  rows: MonitorRow[];
  loading: boolean;
  onOpen: (row: MonitorRow) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <ListEmpty
        title={ar ? "لا توجد حالات مطابقة" : "No cases match these filters"}
        hint={ar ? "جرّب تغيير العرض أو المرشحات." : "Try a different view or clear the filters."}
      />
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const unit = (ar ? r.unit_name_ar : r.unit_name_en) ?? (ar ? "غير مسندة" : "Unassigned");
        const sla = SLA_LABEL[r.sla_status] ?? { en: r.sla_status, ar: r.sla_status };
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            className={cn(
              "w-full rounded-lg border bg-card p-3 text-start transition hover:border-primary/40 hover:shadow-sm",
              r.critical_alert && "border-destructive/40",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-muted-foreground"><bdi dir="ltr">{r.case_number}</bdi></span>
                  <Badge variant="outline" className="h-5 text-[11px]">
                    {typeText(r.case_type, ar)}
                  </Badge>
                  {r.critical_alert ? (
                    <Badge className="h-5 gap-1 bg-destructive text-[11px] text-destructive-foreground">
                      <Flame className="size-3" aria-hidden />
                      {ar ? "بلاغ حرِج" : "Critical alert"}
                    </Badge>
                  ) : null}
                  {r.escalation_unresolved ? (
                    <Badge variant="outline" className="h-5 gap-1 text-[11px]">
                      <ArrowUpRight className="size-3" aria-hidden />
                      {ar ? `تصعيد ${r.escalation_level ?? 1}` : `Escalated L${r.escalation_level ?? 1}`}
                    </Badge>
                  ) : null}
                  {r.stalled ? (
                    <Badge variant="outline" className="h-5 gap-1 text-[11px]">
                      <TimerOff className="size-3" aria-hidden />
                      {ar ? "متوقفة" : "Stalled"}
                    </Badge>
                  ) : null}
                  {r.closure_incomplete ? (
                    <Badge variant="outline" className="h-5 gap-1 text-[11px]">
                      <AlertTriangle className="size-3" aria-hidden />
                      {ar ? "لم يُبلَّغ الطالب" : "Student not told"}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-1 text-sm font-medium">{r.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {unit}
                  {r.student_name ? ` · ${r.student_name}` : ""}
                  {r.owner_name ? ` · ${r.owner_name}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="outline" className={cn("h-5 text-[11px]", slaClasses(r.sla_status))}>
                  {ar ? sla.ar : sla.en}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {ar ? "مع" : "With"} {actorText(r.actor, ar)} · {duration(r.waiting_seconds, ar)}
                </span>
                {r.response_overdue ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-destructive">
                    <Clock className="size-3" aria-hidden />
                    {ar ? "لا يوجد رد" : "No response"}
                  </span>
                ) : null}
              </div>
            </div>

            {r.next_action_en || r.next_action_ar ? (
              <p className="mt-2 line-clamp-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                {ar ? (r.next_action_ar ?? r.next_action_en) : (r.next_action_en ?? r.next_action_ar)}
              </p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
