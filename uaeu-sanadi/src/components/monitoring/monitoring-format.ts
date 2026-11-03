/** Shared bilingual formatting + colour rules for the monitoring surfaces. */
import type { MonitorSlaStatus } from "@/lib/monitoring/monitoring.functions";

export function duration(seconds: number | null | undefined, ar: boolean): string {
  if (seconds == null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  if (m < 60) return ar ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return ar ? `${h} س` : `${h}h`;
  const d = Math.floor(h / 24);
  return ar ? `${d} ي` : `${d}d`;
}

export const SLA_LABEL: Record<MonitorSlaStatus, { en: string; ar: string }> = {
  on_track: { en: "On track", ar: "ضمن المدة" },
  attention: { en: "Attention", ar: "يحتاج متابعة" },
  critical: { en: "Critical", ar: "حرِج" },
  breached: { en: "Breached", ar: "تجاوز المدة" },
  paused: { en: "Paused", ar: "موقوف مؤقتاً" },
  completed: { en: "Completed", ar: "مكتمل" },
};

export function slaClasses(status: string): string {
  switch (status) {
    case "breached":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "critical":
      return "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-400";
    case "attention":
      return "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400";
    case "paused":
      return "bg-muted text-muted-foreground border-border";
    case "completed":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400";
    default:
      return "bg-primary/10 text-primary border-primary/20";
  }
}

export const ACTOR_LABEL: Record<string, { en: string; ar: string }> = {
  ai: { en: "Sanadi AI", ar: "سندي الذكي" },
  student: { en: "Student", ar: "الطالب" },
  service_owner: { en: "Service owner", ar: "مالك الخدمة" },
  specific_officer: { en: "Assigned officer", ar: "الموظف المسؤول" },
  external_party: { en: "External party", ar: "جهة خارجية" },
  manager: { en: "Manager", ar: "المدير" },
  staff: { en: "Staff", ar: "الموظفون" },
  system: { en: "System", ar: "النظام" },
};

export const actorText = (actor: string, ar: boolean) =>
  ar ? (ACTOR_LABEL[actor]?.ar ?? actor) : (ACTOR_LABEL[actor]?.en ?? actor);

export const TYPE_LABEL: Record<string, { en: string; ar: string }> = {
  query: { en: "Query", ar: "استفسار" },
  complaint: { en: "Complaint", ar: "شكوى" },
  suggestion: { en: "Suggestion", ar: "اقتراح" },
  service_request: { en: "Service request", ar: "طلب خدمة" },
  alert: { en: "Alert", ar: "بلاغ" },
};

export const typeText = (t: string, ar: boolean) =>
  ar ? (TYPE_LABEL[t]?.ar ?? t) : (TYPE_LABEL[t]?.en ?? t);

export const statusText = (s: string, ar: boolean) =>
  ar ? s.replace(/_/g, " ") : s.replace(/_/g, " ");
