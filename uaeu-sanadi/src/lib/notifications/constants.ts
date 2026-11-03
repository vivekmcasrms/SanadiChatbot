/** Client-safe constants shared by the Sanadi email notification system. */

export type NotificationSeverity = "normal" | "important" | "critical" | "emergency";

/** Optional (student-controllable) email categories. Operational categories are never optional. */
export const OPTIONAL_EMAIL_CATEGORIES = [
  "service_updates",
  "career",
  "reminders",
  "library",
  "informational",
] as const;

export const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  service_updates: { en: "Service updates", ar: "تحديثات الخدمات" },
  career: { en: "Career & internships", ar: "المسار المهني والتدريب" },
  reminders: { en: "Reminders", ar: "التذكيرات" },
  library: { en: "Library", ar: "المكتبة" },
  informational: { en: "Informational", ar: "معلومات عامة" },
  owner_action: { en: "Owner actions", ar: "إجراءات مالك الخدمة" },
  admin_ops: { en: "Operational alerts", ar: "تنبيهات تشغيلية" },
  emergency: { en: "Emergency", ar: "الطوارئ" },
  general: { en: "General", ar: "عام" },
};

export const SEVERITY_LABELS: Record<NotificationSeverity, { en: string; ar: string }> = {
  normal: { en: "Normal", ar: "عادي" },
  important: { en: "Important", ar: "مهم" },
  critical: { en: "Critical", ar: "حرج" },
  emergency: { en: "Emergency", ar: "طارئ" },
};

/**
 * Maps the in-app event vocabulary already used across the platform onto the
 * email event catalogue. Events not listed here stay in-app only.
 */
export const IN_APP_TO_EMAIL_EVENT: Record<string, string> = {
  case_submitted: "CASE_CREATED",
  case_resolved: "CASE_RESOLVED",
  case_closed: "CASE_RESOLVED",
  case_reopened: "CASE_REOPENED",
  case_escalated: "CASE_ESCALATED",
  information_requested: "STUDENT_ACTION_REQUIRED",
  resolution_proposed: "COMPLAINT_RESPONSE_AVAILABLE",
  suggestion_status_changed: "SUGGESTION_DECISION",
  sla_warning: "SLA_WARNING",
  sla_overdue: "SLA_BREACHED",
  approval_assigned: "OWNER_APPROVAL_REQUIRED",
  new_assignment: "OWNER_DECISION_REQUIRED",
  document_ready: "DOCUMENT_READY",
  appointment_booked: "APPOINTMENT_BOOKED",
  appointment_changed: "APPOINTMENT_CHANGED",
  appointment_cancelled: "APPOINTMENT_CANCELLED",
  appointment_reminder: "APPOINTMENT_REMINDER",
  housing_allocation_offered: "HOUSING_ALLOCATION_OFFERED",
  housing_confirmed: "HOUSING_CONFIRMED",
  internship_offered: "INTERNSHIP_PLACEMENT_OFFERED",
  internship_confirmation_required: "INTERNSHIP_CONFIRMATION_REQUIRED",
  internship_clearance_required: "INTERNSHIP_CLEARANCE_REQUIRED",
  internship_finalized: "INTERNSHIP_FINALIZED",
  transfer_confirmation_required: "TRANSFER_CONFIRMATION_REQUIRED",
  transfer_completed: "TRANSFER_COMPLETED",
  career_report_ready: "CAREER_REPORT_READY",
};

export const DELIVERY_STATUSES = [
  "queued",
  "retrying",
  "sending",
  "sent",
  "failed",
  "skipped",
  "suppressed",
] as const;
