/**
 * Shared vocabulary for the four platform-wide interaction types.
 * Client-safe: no server imports here.
 */

export type InteractionType = "query" | "complaint" | "suggestion" | "alert";

export type InteractionSeverity = "low" | "normal" | "high" | "critical";

export type ResponsibleActor = "ai" | "student" | "service_owner" | "external_party" | "system";

export type AutomationLevel = "auto_resolve" | "auto_manage" | "assisted" | "human_review";

export type EntryChannel = "chat" | "shortcut";

export const INTERACTION_TYPES: InteractionType[] = ["query", "complaint", "suggestion", "alert"];

export const INTERACTION_LABEL: Record<InteractionType, { en: string; ar: string }> = {
  query: { en: "Question", ar: "استفسار" },
  complaint: { en: "Complaint", ar: "شكوى" },
  suggestion: { en: "Suggestion", ar: "اقتراح" },
  alert: { en: "Alert / Emergency", ar: "تنبيه / طوارئ" },
};

export const SEVERITY_LABEL: Record<InteractionSeverity, { en: string; ar: string }> = {
  low: { en: "Low", ar: "منخفضة" },
  normal: { en: "Normal", ar: "عادية" },
  high: { en: "High", ar: "مرتفعة" },
  critical: { en: "Critical", ar: "حرجة" },
};

export const ACTOR_LABEL: Record<ResponsibleActor, { en: string; ar: string }> = {
  ai: { en: "Sanadi", ar: "سندي" },
  student: { en: "Waiting for you", ar: "بانتظار ردك" },
  service_owner: { en: "Service team", ar: "فريق الخدمة" },
  external_party: { en: "External party", ar: "جهة خارجية" },
  system: { en: "System", ar: "النظام" },
};

/** Structured classification result. Internal — never rendered raw to a student. */
export type InteractionClassification = {
  interactionType: InteractionType;
  serviceCode: string;
  serviceLabel: { en: string; ar: string };
  topic: string;
  rootCauseCode: string | null;
  priority: "low" | "medium" | "high" | "critical";
  severity: InteractionSeverity;
  automationLevel: AutomationLevel;
  confidence: number;
  humanAttentionRequired: boolean;
  attentionReason: string | null;
  isEmergency: boolean;
  alertType: string | null;
  isSensitive: boolean;
  /** A secondary improvement idea detected inside a complaint/alert message. */
  secondarySuggestion: boolean;
  /** The shortcut the student used, when it disagreed with the classifier. */
  overriddenHint: InteractionType | null;
  reasonEn: string;
  reasonAr: string;
};
