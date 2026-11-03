/**
 * The structured exception model.
 *
 * Every failure Sanadi can hit has one entry here: how it is detected, what
 * the student is told (never a technical error), what Sanadi tries by itself,
 * when a human is pulled in, and what happens if nothing works.
 */

export type ExceptionCode =
  | "missing_student_data"
  | "missing_knowledge"
  | "api_failure"
  | "rag_failure"
  | "document_generation_failure"
  | "notification_failure"
  | "staff_unavailable"
  | "invalid_upload"
  | "expired_session"
  | "ambiguous_intent"
  | "conflicting_policy"
  | "missing_unit_assignment"
  | "booking_conflict"
  | "low_confidence";

export type ExceptionSpec = {
  code: ExceptionCode;
  /** How the condition is recognised in code. */
  detection: string;
  message: { en: string; ar: string };
  /** What Sanadi attempts automatically, in order. */
  recovery: string;
  /** How often, and how, the operation is safely re-attempted. */
  retry: string;
  /** When this stops being automatic and a person is involved. */
  escalation: string;
  /** What the student gets if every recovery step fails. */
  fallback: { en: string; ar: string };
  severity: "info" | "warning" | "error";
};

export const EXCEPTIONS: Record<ExceptionCode, ExceptionSpec> = {
  missing_student_data: {
    code: "missing_student_data",
    detection: "A required student record field (programme, credits, GPA, student number) is null.",
    message: {
      en: "I could not read part of your student record, so I have kept my answer to what I can confirm.",
      ar: "تعذّر عليّ قراءة جزء من سجلك الجامعي، لذا اقتصرت إجابتي على ما يمكنني تأكيده.",
    },
    recovery: "Re-read the record once, then answer from the verified fields only.",
    retry: "One automatic re-read of the record; never repeated in a loop.",
    escalation: "Open a tracked request with Admission & Registration when the missing field blocks the request.",
    fallback: {
      en: "I have asked the responsible unit to check your record and they will contact you.",
      ar: "طلبت من الوحدة المسؤولة مراجعة سجلك وسيتم التواصل معك.",
    },
    severity: "warning",
  },
  missing_knowledge: {
    code: "missing_knowledge",
    detection: "Retrieval returns no chunk above the relevance threshold for an institutional question.",
    message: {
      en: "I do not have an approved university document that answers this yet.",
      ar: "لا يوجد لديّ مستند جامعي معتمد يجيب على هذا حتى الآن.",
    },
    recovery: "Retry with a broadened query and section-aware matching, then record a knowledge gap.",
    retry: "One broadened retrieval attempt, then stop and offer a tracked request.",
    escalation: "Offer to send the question to the responsible unit as a tracked request.",
    fallback: {
      en: "I can send your question to the responsible unit so a person answers it officially.",
      ar: "يمكنني إرسال سؤالك إلى الوحدة المسؤولة ليجيب عليه موظف رسمياً.",
    },
    severity: "warning",
  },
  api_failure: {
    code: "api_failure",
    detection: "An external service call times out or returns a non-success status.",
    message: {
      en: "That service is not responding right now, so I used the information I can verify.",
      ar: "لا تستجيب هذه الخدمة حالياً، لذا اعتمدت على المعلومات التي يمكنني التحقق منها.",
    },
    recovery: "Retry once, then use the most recent verified cached data when it is still valid.",
    retry: "Exactly one retry with a short timeout, then verified cached data.",
    escalation: "Create a tracked request when the student needs the live result to proceed.",
    fallback: {
      en: "Please try again shortly — I have noted the problem for the technical team.",
      ar: "يرجى المحاولة بعد قليل — سجّلت المشكلة للفريق الفني.",
    },
    severity: "error",
  },
  rag_failure: {
    code: "rag_failure",
    detection: "The retrieval pipeline throws, or embeddings are unavailable.",
    message: {
      en: "I could not search the university documents just now.",
      ar: "تعذّر عليّ البحث في مستندات الجامعة في الوقت الحالي.",
    },
    recovery: "Fall back to keyword and heading search over the indexed content.",
    retry: "One retry on the keyword path only; the vector path is not retried.",
    escalation: "Offer a tracked request to the responsible unit.",
    fallback: {
      en: "I can pass your question to the responsible unit instead.",
      ar: "يمكنني تحويل سؤالك إلى الوحدة المسؤولة بدلاً من ذلك.",
    },
    severity: "error",
  },
  document_generation_failure: {
    code: "document_generation_failure",
    detection: "Letter rendering or storage upload fails before a document record exists.",
    message: {
      en: "The letter could not be produced just now. Nothing was issued, so it is safe to try again.",
      ar: "تعذّر إصدار الشهادة الآن. لم يتم إصدار أي وثيقة، ويمكنك المحاولة مرة أخرى بأمان.",
    },
    recovery: "Retry once; never leave a half-written document record behind.",
    retry: "One retry of the whole generation; partial output is discarded first.",
    escalation: "Open a tracked request with Admission & Registration after a second failure.",
    fallback: {
      en: "I have asked Admission & Registration to issue the letter for you.",
      ar: "طلبت من القبول والتسجيل إصدار الشهادة نيابة عنك.",
    },
    severity: "error",
  },
  notification_failure: {
    code: "notification_failure",
    detection: "A notification or email insert/dispatch returns an error.",
    message: {
      en: "Your request is saved. You can always follow it in My Requests.",
      ar: "تم حفظ طلبك، ويمكنك دائماً متابعته من طلباتي.",
    },
    recovery: "Keep the in-app notification, queue the message again on the next dispatch run.",
    retry: "Queued for the next dispatch run, up to three runs, then flagged.",
    escalation: "Flag for administrators when delivery keeps failing for the same case.",
    fallback: {
      en: "Follow your request in My Requests — every update is shown there.",
      ar: "تابع طلبك من طلباتي — تظهر جميع التحديثات هناك.",
    },
    severity: "warning",
  },
  staff_unavailable: {
    code: "staff_unavailable",
    detection: "No active, available staff member in the responsible unit can take the case.",
    message: {
      en: "Your request is with the responsible unit and someone will be named shortly.",
      ar: "طلبك لدى الوحدة المسؤولة وسيتم تحديد الموظف المسؤول قريباً.",
    },
    recovery: "Assign the unit owner and flag the case for administrator attention.",
    retry: "No retry of assignment; the case moves to the unit queue immediately.",
    escalation: "Administrators see the case in Requests & Cases as needing assignment.",
    fallback: {
      en: "The unit manager is handling your request directly.",
      ar: "يتولى مدير الوحدة طلبك مباشرة.",
    },
    severity: "warning",
  },
  invalid_upload: {
    code: "invalid_upload",
    detection: "File type, size or content scan rejects the upload.",
    message: {
      en: "I could not read that file. Please upload a PDF or Word file under 10 MB.",
      ar: "تعذّر عليّ قراءة الملف. يرجى رفع ملف PDF أو Word بحجم أقل من 10 ميغابايت.",
    },
    recovery: "Keep the previous valid file; nothing is deleted until a new file is accepted.",
    retry: "No automatic retry — the student uploads a corrected file.",
    escalation: "Offer a tracked request so staff can receive the document another way.",
    fallback: {
      en: "You can attach the file to a request and the team will collect it there.",
      ar: "يمكنك إرفاق الملف بطلب وسيستلمه الفريق من هناك.",
    },
    severity: "info",
  },
  expired_session: {
    code: "expired_session",
    detection: "The request carries no valid bearer token, or the token no longer verifies.",
    message: {
      en: "Your session ended for security. Please sign in again — your chats and requests are saved.",
      ar: "انتهت الجلسة لأسباب أمنية. يرجى تسجيل الدخول مجدداً — محادثاتك وطلباتك محفوظة.",
    },
    recovery: "Refresh the session once; keep the typed message so nothing is lost.",
    retry: "One silent session refresh, then a sign-in prompt.",
    escalation: "None — this is a sign-in matter.",
    fallback: {
      en: "Sign in again and reopen the chat; nothing you sent was lost.",
      ar: "سجّل الدخول مرة أخرى وأعد فتح المحادثة؛ لم يُفقد أي شيء أرسلته.",
    },
    severity: "info",
  },
  ambiguous_intent: {
    code: "ambiguous_intent",
    detection: "Two or more service domains score within a narrow margin of each other.",
    message: {
      en: "I want to get this right — could you tell me in one line what you need?",
      ar: "أريد أن أفهم طلبك بدقة — هل يمكنك توضيح ما تحتاجه في سطر واحد؟",
    },
    recovery: "Ask exactly one short clarification question, never a list.",
    retry: "No retry — one clarification question instead.",
    escalation: "After one unclear reply, hand over to a staff member with the conversation attached.",
    fallback: {
      en: "I will pass this to a staff member with what you have already told me.",
      ar: "سأحوّل الطلب إلى موظف مع كل ما ذكرته لي.",
    },
    severity: "info",
  },
  conflicting_policy: {
    code: "conflicting_policy",
    detection: "Two approved sources give different answers to the same question.",
    message: {
      en: "Approved documents differ on this point, so I am giving you the most recent official statement.",
      ar: "تختلف المستندات المعتمدة حول هذه النقطة، لذا أعرض عليك أحدث نص رسمي.",
    },
    recovery: "Prefer the most recent effective document and show its date and owning unit.",
    retry: "No retry — the most recent effective document is used.",
    escalation: "Record the conflict for the Knowledge Center and offer contact with the owning unit.",
    fallback: {
      en: "Please confirm with the owning unit — I have flagged the difference for review.",
      ar: "يرجى التأكد من الوحدة المالكة — سجّلت هذا الاختلاف للمراجعة.",
    },
    severity: "warning",
  },
  missing_unit_assignment: {
    code: "missing_unit_assignment",
    detection: "A case is created but no responsible service unit could be determined from routing.",
    message: {
      en: "Your request is recorded. I am confirming which team should handle it.",
      ar: "تم تسجيل طلبك. أقوم بتحديد الفريق المسؤول عن معالجته.",
    },
    recovery: "Re-run routing once with the case text, then place the case in the general Service Desk queue.",
    retry: "One routing re-run; the case is never left without a queue.",
    escalation: "Administrators see the case flagged as needing a unit in Requests & Cases.",
    fallback: {
      en: "The Service Desk is holding your request and will direct it to the right team.",
      ar: "مكتب الخدمة يحتفظ بطلبك وسيوجهه إلى الفريق المناسب.",
    },
    severity: "warning",
  },
  booking_conflict: {
    code: "booking_conflict",
    detection: "The booking transaction rejects the slot: it filled up, overlaps another appointment, or was withdrawn.",
    message: {
      en: "That time was taken while we were confirming it, so nothing was booked.",
      ar: "تم حجز هذا الموعد أثناء تأكيده، لذا لم يتم تسجيل أي حجز.",
    },
    recovery: "Re-read the live availability once and offer the remaining times for the same unit.",
    retry: "No blind retry on the same slot; availability is re-read instead.",
    escalation: "Offer a meeting request to the unit when no alternative time is published.",
    fallback: {
      en: "I can send a meeting request to the unit and they will propose a time.",
      ar: "يمكنني إرسال طلب موعد إلى الوحدة وسيقترحون وقتاً مناسباً.",
    },
    severity: "warning",
  },
  low_confidence: {
    code: "low_confidence",
    detection: "The grounded answer scores below the configured confidence threshold.",
    message: {
      en: "I am not confident enough to answer this officially.",
      ar: "لست واثقاً بما يكفي للإجابة رسمياً على هذا.",
    },
    recovery: "Re-run retrieval once with the question rephrased around its key terms.",
    retry: "One rephrased retrieval attempt before declining to answer.",
    escalation: "Offer a tracked request to the responsible unit instead of guessing.",
    fallback: {
      en: "I can open a request so the responsible unit answers you officially.",
      ar: "يمكنني فتح طلب لتجيبك الوحدة المسؤولة رسمياً.",
    },
    severity: "warning",
  },
};

export function exceptionMessage(code: ExceptionCode, lang: "en" | "ar"): string {
  return EXCEPTIONS[code].message[lang];
}

export function exceptionFallback(code: ExceptionCode, lang: "en" | "ar"): string {
  return EXCEPTIONS[code].fallback[lang];
}

/** Plain-language names for the admin recovery log. Never shown to students. */
export const EXCEPTION_LABELS: Record<ExceptionCode, { en: string; ar: string }> = {
  missing_student_data: { en: "Student record incomplete", ar: "سجل الطالب غير مكتمل" },
  missing_knowledge: { en: "No approved document found", ar: "لا يوجد مستند معتمد" },
  api_failure: { en: "External service not responding", ar: "خدمة خارجية لا تستجيب" },
  rag_failure: { en: "Document search unavailable", ar: "تعذّر البحث في المستندات" },
  document_generation_failure: { en: "Letter could not be produced", ar: "تعذّر إصدار الشهادة" },
  notification_failure: { en: "Notification not delivered", ar: "تعذّر إرسال الإشعار" },
  staff_unavailable: { en: "No staff member available", ar: "لا يوجد موظف متاح" },
  invalid_upload: { en: "File could not be accepted", ar: "تعذّر قبول الملف" },
  expired_session: { en: "Session ended", ar: "انتهت الجلسة" },
  ambiguous_intent: { en: "Request not clear enough", ar: "الطلب غير واضح بما يكفي" },
  conflicting_policy: { en: "Approved documents disagree", ar: "تعارض بين المستندات المعتمدة" },
  missing_unit_assignment: { en: "No responsible unit determined", ar: "لم تُحدد الوحدة المسؤولة" },
  booking_conflict: { en: "Appointment time taken", ar: "الموعد محجوز" },
  low_confidence: { en: "Answer confidence too low", ar: "مستوى الثقة منخفض" },
};

export function isExceptionCode(value: string): value is ExceptionCode {
  return Object.prototype.hasOwnProperty.call(EXCEPTIONS, value);
}
