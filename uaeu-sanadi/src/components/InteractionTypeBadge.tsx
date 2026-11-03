/**
 * One shared label for the interaction types a Service Owner sees inside the
 * ordinary request lists: Query, Complaint, Suggestion, Alert, Request.
 * There are no separate modules per type — only a clear label and filter.
 */
import { AlertTriangle, FileText, HelpCircle, Lightbulb, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type Meta = { en: string; ar: string; tone: string; icon: typeof HelpCircle };

const TYPE_META: Record<string, Meta> = {
  query: { en: "Query", ar: "استفسار", tone: "bg-info/10 text-info", icon: HelpCircle },
  complaint: {
    en: "Complaint",
    ar: "شكوى",
    tone: "bg-warning/20 text-warning-foreground",
    icon: MessageSquareWarning,
  },
  suggestion: { en: "Suggestion", ar: "اقتراح", tone: "bg-accent text-accent-foreground", icon: Lightbulb },
  alert: { en: "Alert", ar: "تنبيه", tone: "bg-destructive/10 text-destructive", icon: AlertTriangle },
  service_request: { en: "Request", ar: "طلب خدمة", tone: "bg-secondary text-secondary-foreground", icon: FileText },
};

export function interactionTypeLabel(type: string, ar: boolean): string {
  const meta = TYPE_META[type];
  return meta ? (ar ? meta.ar : meta.en) : type.replace(/_/g, " ");
}

export function InteractionTypeBadge({ type, className }: { type: string; className?: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const meta = TYPE_META[type];
  const Icon = meta?.icon ?? FileText;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        meta?.tone ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {interactionTypeLabel(type, ar)}
    </span>
  );
}
