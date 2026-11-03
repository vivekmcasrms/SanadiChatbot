/**
 * Operational summary for the monitoring workspace.
 *
 * Reads as an answer to "where does the university stand right now?" — the
 * numbers that demand action come first, and each card doubles as a one-click
 * filter into the queue below.
 */
import type { MonitorSummary } from "@/lib/monitoring/monitoring.functions";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Tile = {
  key: string;
  en: string;
  ar: string;
  value: number;
  tone: "neutral" | "warn" | "danger";
  filter: Record<string, string>;
};

export function MonitoringSummary({
  data,
  loading,
  onSelect,
  activeKey,
}: {
  data: MonitorSummary | undefined;
  loading: boolean;
  onSelect: (filter: Record<string, string>, key: string) => void;
  activeKey?: string | undefined;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      key: "active",
      en: "Active cases",
      ar: "الحالات النشطة",
      value: data.active,
      tone: "neutral",
      filter: { view: "open", sla: "all", actor: "all", escalation: "all" },
    },
    {
      key: "breached",
      en: "SLA breached",
      ar: "تجاوز المدة",
      value: data.breached,
      tone: "danger",
      filter: { view: "open", sla: "breached" },
    },
    {
      key: "critical",
      en: "SLA critical",
      ar: "حرِج",
      value: data.critical,
      tone: "warn",
      filter: { view: "open", sla: "critical" },
    },
    {
      key: "responseOverdue",
      en: "No response yet",
      ar: "بلا رد حتى الآن",
      value: data.responseOverdue,
      tone: "danger",
      filter: { view: "intervention" },
    },
    {
      key: "escalated",
      en: "Open escalations",
      ar: "تصعيدات مفتوحة",
      value: data.escalated,
      tone: "warn",
      filter: { view: "open", escalation: "unresolved" },
    },
    {
      key: "criticalAlerts",
      en: "Critical alerts",
      ar: "بلاغات حرجة",
      value: data.criticalAlerts,
      tone: "danger",
      filter: { view: "open", type: "alert", priority: "critical" },
    },
    {
      key: "waitingStudent",
      en: "Waiting on student",
      ar: "بانتظار الطالب",
      value: data.waitingStudent,
      tone: "neutral",
      filter: { view: "open", actor: "student" },
    },
    {
      key: "waitingExternal",
      en: "Waiting on external",
      ar: "بانتظار جهة خارجية",
      value: data.waitingExternal,
      tone: "warn",
      filter: { view: "open", actor: "external_party" },
    },
    {
      key: "stalled",
      en: "Stalled (no movement)",
      ar: "متوقفة بلا حركة",
      value: data.stalled,
      tone: "warn",
      filter: { view: "intervention" },
    },
    {
      key: "closureIncomplete",
      en: "Closed, student not told",
      ar: "أُغلقت دون إبلاغ الطالب",
      value: data.closureIncomplete,
      tone: "warn",
      filter: { view: "closure" },
    },
    {
      key: "openComplaints",
      en: "Unresolved complaints",
      ar: "شكاوى دون حل",
      value: data.openComplaints,
      tone: "neutral",
      filter: { view: "open", type: "complaint" },
    },
    {
      key: "openSuggestions",
      en: "Unresolved suggestions",
      ar: "اقتراحات دون حل",
      value: data.openSuggestions,
      tone: "neutral",
      filter: { view: "open", type: "suggestion" },
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {tiles.map((t) => (
        <Card
          key={t.key}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(t.filter, t.key)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(t.filter, t.key);
            }
          }}
          className={cn(
            "cursor-pointer p-3 transition hover:border-primary/40 hover:shadow-sm",
            activeKey === t.key && "border-primary ring-1 ring-primary/30",
          )}
        >
          <p className="text-xs text-muted-foreground">{ar ? t.ar : t.en}</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              t.tone === "danger" && t.value > 0 && "text-destructive",
              t.tone === "warn" && t.value > 0 && "text-orange-600 dark:text-orange-400",
            )}
          >
            {t.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
