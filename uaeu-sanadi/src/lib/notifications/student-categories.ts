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
  | "alerts"
  | "other";

export const STUDENT_NOTIFICATION_TABS = [
  { code: "all", en: "All", ar: "الكل" },
  { code: "unread", en: "Unread", ar: "غير المقروءة" },
  { code: "requests", en: "Requests", ar: "الطلبات" },
  { code: "appointments", en: "Appointments", ar: "المواعيد" },
  { code: "documents", en: "Documents", ar: "المستندات" },
  { code: "alerts", en: "University Alerts", ar: "تنبيهات الجامعة" },
] as const;

/** Requests, complaints and suggestions are all filed under the Requests tab. */
export function matchesTab(category: StudentNotificationCategory, readAt: string | null, tab: StudentNotificationTab): boolean {
  if (tab === "all") return true;
  if (tab === "unread") return !readAt;
  if (tab === "requests") return category === "requests" || category === "complaints" || category === "suggestions";
  return category === tab;
}

export type StudentNotificationTab = (typeof STUDENT_NOTIFICATION_TABS)[number]["code"];

export const CATEGORY_LABEL: Record<StudentNotificationCategory, { en: string; ar: string }> = {
  requests: { en: "Request", ar: "طلب" },
  complaints: { en: "Complaint", ar: "شكوى" },
  suggestions: { en: "Suggestion", ar: "اقتراح" },
  appointments: { en: "Appointment", ar: "موعد" },
  documents: { en: "Document", ar: "مستند" },
  alerts: { en: "University Alert", ar: "تنبيه جامعي" },
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

const DOCUMENT_EVENTS = new Set(["document_ready", "document_generated", "document_issued", "career_report_ready"]);

const ALERT_EVENTS = new Set(["emergency_broadcast", "university_alert", "broadcast"]);

const SUGGESTION_EVENTS = new Set(["suggestion_status_changed"]);

/** A short, human title per event type — never a technical code. */
export const EVENT_TITLE: Record<string, { en: string; ar: string }> = {
  transfer_submitted: {en:"Transfer Request Submitted",ar:"تم تقديم طلب التحويل"},
  transfer_approve: {en:"Transfer Request Approved",ar:"تمت الموافقة على طلب التحويل"},
  transfer_reject: {en:"Transfer Request Rejected",ar:"تم رفض طلب التحويل"},
  transfer_complete: {en:"Transfer Request Completed",ar:"اكتمل طلب التحويل"},
  hostel_submitted: { en: "Hostel Request Submitted", ar: "تم تقديم طلب السكن" },
  hostel_room_assigned: { en: "Hostel Room Assigned", ar: "تم تحديد غرفة السكن" },
  hostel_confirmed: { en: "Hostel Booking Confirmed", ar: "تم تأكيد حجز السكن" },
  hostel_cancelled: { en: "Hostel Booking Cancelled", ar: "تم إلغاء حجز السكن" },
  hostel_completed: { en: "Hostel Request Completed", ar: "اكتمل طلب السكن" },
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
  sla_warning: { en: "Deadline Approaching", ar: "اقتراب الموعد النهائي" },
  sla_overdue: { en: "Request Overdue", ar: "تجاوز الموعد النهائي" },
  new_assignment: { en: "New Case Assigned", ar: "حالة جديدة مسندة إليك" },
  urgent_assignment: { en: "Urgent Case Assigned", ar: "حالة عاجلة مسندة إليك" },
  hostel_request_update: { en: "Hostel Request Update", ar: "تحديث طلب السكن" },
};

/**
 * Arabic body for notifications stored with English-only text. Built from the
 * event type and structured payload; references, dates and names stay as-is.
 * Returns null when no faithful Arabic wording is known.
 */
export function arabicNotificationBody(
  eventType: string,
  payload: Record<string, unknown> | null,
  reference: string | null,
): string | null {
  const p = payload ?? {};
  const str = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string).trim() : null);
  const ref = reference ?? str("case_number") ?? str("reference");
  const R = ref ? `\u2068${ref}\u2069` : "طلبك";
  const when = str("when") ?? str("due");
  const unit = str("unit");
  const staff = str("staff_name");
  switch (eventType) {
    case "sla_warning": return `الطلب ${R} يقترب من موعده النهائي.`;
    case "sla_overdue": return `الطلب ${R} تجاوز موعده النهائي.`;
    case "case_delayed": return `تأخر الطلب ${R}${when ? ` — الموعد المتوقع الجديد \u2068${when}\u2069` : ""}.`;
    case "case_submitted": return `تم استلام الطلب ${R}.`;
    case "case_acknowledged": return `تم الإقرار بالطلب ${R}.`;
    case "case_assigned": return `الطلب ${R} لدى ${unit ?? "الجهة المختصة"}${staff ? ` — يتابعه ${staff}` : ""}.`;
    case "case_escalated": return `تم تصعيد الطلب ${R}.`;
    case "case_reopened": return `تمت إعادة فتح الطلب ${R}.`;
    case "case_resolved": return `تم حل الطلب ${R}.`;
    case "case_closed": return `تم إغلاق الطلب ${R}.`;
    case "case_status_changed": return `تم تحديث حالة الطلب ${R}.`;
    case "information_requested": return `مطلوب معلومات إضافية للطلب ${R}.`;
    case "resolution_proposed": return `تم اقتراح حل للطلب ${R}.`;
    case "case_message": return `رسالة جديدة بخصوص الطلب ${R}.`;
    case "document_ready": return `شهادتك الرسمية ${R} جاهزة للعرض والتنزيل.`;
    case "suggestion_status_changed": return `تم تحديث حالة الاقتراح ${R}.`;
    case "appointment_booked":
    case "case_meeting_set":
      return `تم تأكيد الموعد${when ? ` — \u2068${when}\u2069` : ""}${staff ? ` مع ${staff}` : ""}${unit ? ` (${unit})` : ""}.`;
    case "appointment_cancelled":
    case "case_meeting_cancelled":
      return `تم إلغاء الموعد${when ? ` — \u2068${when}\u2069` : ""}.`;
    case "appointment_request_created": return `تم إرسال طلب اللقاء${unit ? ` إلى ${unit}` : ""}.`;
    case "new_assignment": return `حالة جديدة مسندة إليك: ${R}.`;
    case "urgent_assignment": return `حالة عاجلة مسندة إليك: ${R}. يرجى الإقرار والرد الآن.`;
    case "hostel_confirmed": return `تم حجز غرفتك في السكن مباشرة${ref ? ` — ${R}` : ""}.`;
    default: return null;
  }
}

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
  if (ALERT_EVENTS.has(eventType)) return "alerts";
  if (SUGGESTION_EVENTS.has(eventType) || caseType === "suggestion") return "suggestions";
  if (caseType === "complaint") return "complaints";
  if (caseType) return "requests";
  if (eventType.startsWith("case_") || eventType.startsWith("information_") || eventType.startsWith("hostel_") || eventType.startsWith("transfer_")) return "requests";
  return "other";
}
