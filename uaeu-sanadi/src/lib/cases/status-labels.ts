/**
 * Plain-language case status labels, shared by the server and the chat UI.
 * Students never see a raw database status value.
 */
import type { Lang } from "../agent-types";

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  draft: { en: "Draft", ar: "مسودة" },
  submitted: { en: "Received", ar: "تم الاستلام" },
  acknowledged: { en: "Acknowledged", ar: "تم الإقرار" },
  classified: { en: "Being routed", ar: "قيد التوجيه" },
  routed: { en: "With the responsible unit", ar: "لدى الجهة المسؤولة" },
  assigned: { en: "Assigned to a staff member", ar: "مُسند إلى موظف" },
  in_progress: { en: "In progress", ar: "قيد المعالجة" },
  in_review: { en: "Under review", ar: "قيد المراجعة" },
  ai_processing: { en: "In progress", ar: "قيد المعالجة" },
  resolution_proposed: { en: "Resolution proposed", ar: "تم اقتراح حل" },
  escalated: { en: "Escalated", ar: "تم التصعيد" },
  on_hold: { en: "On hold", ar: "معلّق" },
  waiting_external: { en: "Waiting on another party", ar: "بانتظار جهة أخرى" },
  awaiting_student: { en: "Waiting for your reply", ar: "بانتظار ردك" },
  student_confirmation: { en: "Waiting for your confirmation", ar: "بانتظار تأكيدك" },
  reopened: { en: "Reopened", ar: "أُعيد فتحه" },
  transferred: { en: "Transferred", ar: "تم تحويله" },
  resolved: { en: "Resolved", ar: "تم الحل" },
  closed: { en: "Closed", ar: "مغلق" },
};

export function statusLabel(status: string, lang: Lang): string {
  const entry = STATUS_LABEL[status];
  if (entry) return lang === "ar" ? entry.ar : entry.en;
  return status.replace(/_/g, " ");
}

