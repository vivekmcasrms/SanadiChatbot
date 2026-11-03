/**
 * Client-safe grouping of in-app notifications for the student notification centre.
 * Purely presentational: it never decides what is sent, only how it is filed.
 */

export type StudentNotificationCategory =
  | "requests"
  | "complaints"
  | "suggestions"
  | "appointments"
  | "documents"
  | "other";

export const STUDENT_NOTIFICATION_TABS = [
  { code: "all", en: "All", ar: "الكل" },
  { code: "unread", en: "Unread", ar: "غير المقروءة" },
  { code: "requests", en: "Requests", ar: "الطلبات" },
  { code: "complaints", en: "Complaints", ar: "الشكاوى" },
  { code: "suggestions", en: "Suggestions", ar: "الاقتراحات" },
  { code: "appointments", en: "Appointments", ar: "المواعيد" },
  { code: "documents", en: "Documents", ar: "المستندات" },
] as const;

export type StudentNotificationTab = (typeof STUDENT_NOTIFICATION_TABS)[number]["code"];

export const CATEGORY_LABEL: Record<StudentNotificationCategory, { en: string; ar: string }> = {
  requests: { en: "Request", ar: "طلب" },
  complaints: { en: "Complaint", ar: "شكوى" },
  suggestions: { en: "Suggestion", ar: "اقتراح" },
  appointments: { en: "Appointment", ar: "موعد" },
  documents: { en: "Document", ar: "مستند" },
  other: { en: "Update", ar: "تحديث" },
};

const APPOINTMENT_EVENTS = new Set([
  "case_meeting_set",
  "case_meeting_cancelled",
  "appointment_booked",
  "appointment_changed",
  "appointment_cancelled",
  "appointment_reminder",
]);

const DOCUMENT_EVENTS = new Set(["document_ready", "document_generated", "career_report_ready"]);

const SUGGESTION_EVENTS = new Set(["suggestion_status_changed"]);

/** A short, human title per event type — never a technical code. */
export const EVENT_TITLE: Record<string, { en: string; ar: string }> = {
  case_submitted: { en: "Request Received", ar: "تم استلام الطلب" },
  case_acknowledged: { en: "Request Acknowledged", ar: "تم الإقرار بالطلب" },
  case_assigned: { en: "Assigned to Staff", ar: "تم إسناد الطلب" },
  case_status_changed: { en: "Status Updated", ar: "تم تحديث الحالة" },
  information_requested: { en: "Action Required", ar: "مطلوب إجراء منك" },
  case_escalated: { en: "Request Escalated", ar: "تم تصعيد الطلب" },
  resolution_proposed: { en: "Resolution Proposed", ar: "تم اقتراح حل" },
  case_resolved: { en: "Request Resolved", ar: "تم حل الطلب" },
  case_closed: { en: "Request Closed", ar: "تم إغلاق الطلب" },
  case_reopened: { en: "Request Reopened", ar: "تمت إعادة فتح الطلب" },
  case_delayed: { en: "Request Delayed", ar: "تأخر الطلب" },
  case_message: { en: "New Message", ar: "رسالة جديدة" },
  new_assignment: { en: "New Assignment", ar: "إسناد جديد" },
  urgent_assignment: { en: "Urgent Assignment", ar: "إسناد عاجل" },
  sla_overdue: { en: "Case Needs Attention", ar: "حالة تحتاج متابعة" },
  sla_warning: { en: "Deadline Approaching", ar: "اقتراب الموعد النهائي" },
  case_meeting_set: { en: "Appointment Confirmed", ar: "تم تأكيد الموعد" },
  case_meeting_cancelled: { en: "Appointment Cancelled", ar: "تم إلغاء الموعد" },
  appointment_booked: { en: "Appointment Confirmed", ar: "تم تأكيد الموعد" },
  appointment_changed: { en: "Appointment Rescheduled", ar: "تم تغيير الموعد" },
  appointment_cancelled: { en: "Appointment Cancelled", ar: "تم إلغاء الموعد" },
  appointment_reminder: { en: "Appointment Reminder", ar: "تذكير بالموعد" },
  document_ready: { en: "Document Ready", ar: "المستند جاهز" },
  suggestion_status_changed: { en: "Suggestion Updated", ar: "تم تحديث الاقتراح" },
  alert_generated: { en: "Report Updated", ar: "تم تحديث البلاغ" },
  satisfaction_survey: { en: "How Did We Do?", ar: "ما رأيك في الخدمة؟" },
  appointment_request_created: { en: "Meeting Request Sent", ar: "تم إرسال طلب اللقاء" },
  information_provided: { en: "Your Reply Was Received", ar: "تم استلام ردك" },
};

/**
 * Notifications are written by many workflows; a few older ones stored the raw
 * event name as their text. The student must never read a technical code.
 */
export function humanText(
  raw: string | null,
  eventType: string,
  reference: string | null,
  lang: "en" | "ar",
): string {
  const text = (raw ?? "").trim();
  const isCode = !text || (/^[a-z0-9_.]+$/.test(text) && !text.includes(" "));
  if (!isCode) return text;
  const title = EVENT_TITLE[eventType];
  const subject = reference
    ? lang === "ar"
      ? `طلبك ${reference}`
      : `your request ${reference}`
    : lang === "ar"
      ? "أحد طلباتك"
      : "one of your requests";
  if (title) return lang === "ar" ? `${title.ar} — ${subject}` : `${title.en} — ${subject}`;
  return lang === "ar" ? `يوجد تحديث على ${subject}.` : `There is an update on ${subject}.`;
}

export function categoriseNotification(eventType: string, caseType: string | null): StudentNotificationCategory {
  if (APPOINTMENT_EVENTS.has(eventType)) return "appointments";
  if (DOCUMENT_EVENTS.has(eventType)) return "documents";
  if (SUGGESTION_EVENTS.has(eventType) || caseType === "suggestion") return "suggestions";
  if (caseType === "complaint") return "complaints";
  if (caseType) return "requests";
  if (eventType.startsWith("case_") || eventType.startsWith("information_")) return "requests";
  return "other";
}
