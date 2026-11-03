import { cn } from "@/lib/utils";
import { useI18n, type TKey } from "@/lib/i18n";

const STATUS_KEY: Record<string, TKey> = {
  draft: "st_draft",
  submitted: "st_submitted",
  acknowledged: "st_acknowledged",
  assigned: "st_assigned",
  in_review: "st_in_review",
  awaiting_student: "st_awaiting_student",
  resolution_proposed: "st_resolution_proposed",
  escalated: "st_escalated",
  resolved: "st_resolved",
  closed: "st_closed",
  under_review: "st_under_review",
  planned: "st_planned",
  implemented: "st_implemented",
  not_proceeding: "st_not_proceeding",
};

const TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-info/10 text-info",
  acknowledged: "bg-info/10 text-info",
  assigned: "bg-info/10 text-info",
  in_review: "bg-warning/15 text-warning-foreground",
  under_review: "bg-warning/15 text-warning-foreground",
  awaiting_student: "bg-warning/20 text-warning-foreground",
  resolution_proposed: "bg-accent text-accent-foreground",
  planned: "bg-accent text-accent-foreground",
  escalated: "bg-destructive/10 text-destructive",
  not_proceeding: "bg-destructive/10 text-destructive",
  resolved: "bg-success/12 text-success",
  implemented: "bg-success/12 text-success",
  closed: "bg-muted text-muted-foreground",
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const key = STATUS_KEY[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {key ? t(key) : status}
    </span>
  );
}

const URGENCY_KEY: Record<string, TKey> = {
  low: "urg_low",
  medium: "urg_medium",
  high: "urg_high",
  critical: "urg_critical",
};

export function UrgencyChip({ urgency }: { urgency: string }) {
  const { t } = useI18n();
  const tone =
    urgency === "critical"
      ? "bg-destructive/10 text-destructive"
      : urgency === "high"
        ? "bg-warning/20 text-warning-foreground"
        : urgency === "medium"
          ? "bg-info/10 text-info"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tone)}>
      {t(URGENCY_KEY[urgency] ?? "urg_low")}
    </span>
  );
}