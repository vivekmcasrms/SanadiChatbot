/**
 * One-time chat actions: actions where repeating the exact same button would
 * create an unwanted duplicate record (a second complaint, a second booking…).
 *
 * Shared by the browser (button state) and the server (duplicate protection),
 * so both sides agree on the same key. Read-only actions are never listed.
 */
export const ONE_TIME_ACTIONS = new Set<string>([
  "create_complaint",
  "create_enquiry",
  "create_suggestion",
  "create_request",
  "create_service_request",
  "report_alert",
  "create_alert",
  "escalate_to_human",
  "book_appointment",
  "reschedule_appointment",
  "request_appointment",
  "issue_enrollment_letter",
  "issue_document",
  "generate_document",
  "request_inter_college_transfer",
  "confirm_internship_assignment",
]);

export function isOneTimeAction(toolName: string | null | undefined): boolean {
  return Boolean(toolName && ONE_TIME_ACTIONS.has(toolName));
}

/**
 * Stable identity of one action button in one chat message for one student.
 * The same string is recomputed on every retry, refresh or extra tab, which is
 * what makes the database uniqueness check work.
 */
export function actionCompletionKey(input: {
  studentId: string;
  conversationId: string | null | undefined;
  messageId: string | null | undefined;
  actionKey: string;
  toolName: string;
}): string {
  return [
    input.studentId,
    input.conversationId ?? "-",
    input.messageId ?? "-",
    input.actionKey,
    input.toolName,
  ].join("|");
}

/** Client-side map key for "this button, in this message". */
export function uiActionKey(messageId: string | null | undefined, actionKey: string): string {
  return `${messageId ?? "-"}:${actionKey}`;
}

/** What the button says once the action really succeeded. */
export function submittedLabel(toolName: string, lang: "en" | "ar"): string {
  const map: Record<string, { en: string; ar: string }> = {
    create_complaint: { en: "Complaint submitted", ar: "تم تقديم الشكوى" },
    create_enquiry: { en: "Enquiry submitted", ar: "تم تقديم الاستفسار" },
    create_suggestion: { en: "Suggestion submitted", ar: "تم إرسال الاقتراح" },
    create_request: { en: "Request submitted", ar: "تم تقديم الطلب" },
    create_service_request: { en: "Request submitted", ar: "تم تقديم الطلب" },
    report_alert: { en: "Alert submitted", ar: "تم إرسال التنبيه" },
    create_alert: { en: "Alert submitted", ar: "تم إرسال التنبيه" },
    escalate_to_human: { en: "Sent to staff", ar: "تمت الإحالة إلى موظف" },
    book_appointment: { en: "Appointment confirmed", ar: "تم تأكيد الموعد" },
    reschedule_appointment: { en: "Appointment rescheduled", ar: "تمت إعادة جدولة الموعد" },
    request_appointment: { en: "Meeting request sent", ar: "تم إرسال طلب اللقاء" },
    issue_enrollment_letter: { en: "Document generated", ar: "تم إصدار المستند" },
    issue_document: { en: "Document generated", ar: "تم إصدار المستند" },
    generate_document: { en: "Document generated", ar: "تم إصدار المستند" },
  };
  return map[toolName]?.[lang] ?? (lang === "ar" ? "تم التنفيذ" : "Submitted");
}
