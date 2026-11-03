/**
 * Complaint intake without student effort.
 *
 * A student who says "I want to complain about the evening bus service" has
 * already given Sanadi everything needed to OPEN the case: the interaction
 * type (complaint), the responsible service (transportation) and the subject
 * (evening bus service). Sanadi therefore creates and persists the case on
 * that first turn and asks only for the one operational detail that is still
 * missing — it never asks the student to repeat what was already said.
 *
 * Detection and routing are deterministic; the model is not involved.
 */
import { serviceLabel } from "@/lib/ops/classify.server";
import { classifyInteraction } from "@/lib/interactions/classify.server";
import { structureComplaint } from "@/lib/interactions/complaint-structure";
import { submitInteraction } from "@/lib/interactions/intake.server";
import type { Lang } from "@/lib/agent-types";

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

/** Explicit complaint framing in English and Arabic. */
const COMPLAINT_RE =
  /(i (want|would like|wish|need) to (file|make|submit|raise|lodge|register)?\s*(a\s+)?complain(t)?|i want to complain|i'?m complaining|i am complaining|(file|make|submit|raise|lodge|register) (a )?complaint|i have (a )?complaint|(this|here) is (a )?complaint|أريد (أن )?(أقدم|تقديم|رفع)?\s*شكوى|اريد (أن )?(أقدم|تقديم|رفع)?\s*شكوى|أود (تقديم|رفع)\s*شكوى|لدي شكوى|عندي شكوى|أشتكي|اشتكي|تقديم شكوى|رفع شكوى)/i;

/** "about the evening bus service" / "بخصوص خدمة الحافلات المسائية" */
const SUBJECT_RE =
  /(?:about|regarding|concerning|on the subject of|with regard to|بخصوص|عن|حول|بشأن|على)\s+(.{3,120})$/is;

export type ComplaintOpening = { subject: string | null };

/** True when the student is opening a complaint, whatever the topic. */
export function detectComplaintOpening(text: string): ComplaintOpening | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 1200) return null;
  if (!COMPLAINT_RE.test(t)) return null;
  const m = SUBJECT_RE.exec(t);
  const subject = m?.[1]?.replace(/[.؟?!،,\s]+$/u, "").trim() ?? null;
  return { subject: subject && subject.length >= 3 ? subject : null };
}

/* ------------------------------------------------------------------ */
/* Turn 1 — open the case with what is already known                   */
/* ------------------------------------------------------------------ */

export type ComplaintIntakeState = {
  caseId: string;
  reference: string;
  trackingUrl: string;
  unitEn: string;
  unitAr: string;
  serviceCode: string;
  subject: string | null;
  awaitingDetail: boolean;
  openedAt: string;
};

export type ComplaintIntakeStart = {
  answer: string;
  question: string;
  state: ComplaintIntakeState;
};

function detailQuestion(lang: Lang, serviceCode: string, structuredAsk: string | null): string {
  if (structuredAsk) return structuredAsk;
  if (serviceCode === "transportation") {
    return lang === "ar"
      ? "أخبرني ماذا حدث بالضبط: هل تأخرت الحافلة، أم لم تصل، أم كانت مزدحمة، أم مشكلة أخرى؟ وفي أي يوم ومن أي موقع؟"
      : "Please tell me what happened, such as whether the bus was late, did not arrive, was overcrowded, or another issue — and on which day and from which stop.";
  }
  return lang === "ar"
    ? "أخبرني ماذا حدث بالضبط ومتى، حتى أتمكن من إحالتها بالمعلومات الكاملة."
    : "Please tell me what happened and when, so I can hand it over with the full picture.";
}

/**
 * Creates and persists the complaint case from the opening message alone.
 * Returns the captured summary plus the single missing-detail question.
 */
export async function startComplaintIntake(opts: {
  userId: string;
  lang: Lang;
  conversationId: string | null;
  message: string;
  subject: string | null;
}): Promise<ComplaintIntakeStart | null> {
  const ar = opts.lang === "ar";
  const title = (opts.subject ?? opts.message).slice(0, 120);

  let result;
  try {
    result = await submitInteraction({
      studentId: opts.userId,
      lang: opts.lang,
      title,
      description: opts.message,
      shortcutHint: "complaint",
      channel: "chat",
      conversationId: opts.conversationId,
    });
  } catch {
    return null;
  }
  if (result.kind !== "case") return null;

  const label = serviceLabel(result.classification.serviceCode);
  const question = detailQuestion(
    opts.lang,
    result.classification.serviceCode,
    (ar ? result.clarifyingQuestionAr : result.clarifyingQuestionEn) ?? null,
  );

  const captured = ar
    ? [
        `بدأتُ شكوى لدى ${label.ar} بناءً على رسالتك.`,
        "",
        "لدي حالياً:",
        "- النوع: شكوى",
        `- الخدمة: ${label.ar}`,
        `- المشكلة: ${opts.subject ?? title}`,
        `- الرقم المرجعي: ${result.reference}`,
        "",
        question,
        "يمكنك إرفاق صورة أو مستند إذا كان ذلك مفيداً، وهو غير مطلوب.",
      ].join("\n")
    : [
        `I've started a complaint for ${label.en} based on your message.`,
        "",
        "I currently have:",
        "- Type: Complaint",
        `- Service: ${label.en}`,
        `- Issue: ${opts.subject ?? title}`,
        `- Reference: ${result.reference}`,
        "",
        question,
        "You can attach a photo or document if it helps — it is not required.",
      ].join("\n");

  return {
    answer: captured,
    question,
    state: {
      caseId: result.id,
      reference: result.reference,
      trackingUrl: result.trackingUrl,
      unitEn: label.en,
      unitAr: label.ar,
      serviceCode: result.classification.serviceCode,
      subject: opts.subject ?? title,
      awaitingDetail: true,
      openedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Turn 2 — the missing detail updates the SAME case                   */
/* ------------------------------------------------------------------ */

export type ComplaintDetailResult = {
  answer: string;
  caseId: string;
  reference: string;
  trackingUrl: string;
};

/** Short replies that are not the requested detail. */
const NON_DETAIL_RE = /^(ok(ay)?|thanks?|thank you|yes|no|hi|hello|شكرا|نعم|لا|تمام|مرحبا)\W*$/i;

/** The student asked something instead of describing what happened. */
const QUESTION_RE =
  /[?؟]\s*$|^\s*(what|what'?s|when|where|why|who|whose|which|how|can (you|i)|could (you|i)|do (i|you)|did (i|you)|does|is|are|will|would|should|show me|tell me|give me|ما|ماذا|كم|هل|متى|أين|اين|كيف|لماذا|من)\b/i;

/** A different service request, not a detail of the open complaint. */
const OTHER_INTENT_RE =
  /(my (gpa|cgpa|grades?|marks?|transcript|timetable|record|records|balance|holds?|credits?|schedule)|gpa|transcript|enrolment letter|enrollment letter|to whom it may concern|book (an )?appointment|schedule (an )?appointment|register (for|in)|add a course|drop a course|my cv|resume|scholarship|graduation|معدلي|معدل|درجاتي|كشف الدرجات|شهادة|رسالة تعريف|موعد|التسجيل|سيرتي الذاتية|منحة|التخرج)/i;

/**
 * True only when the reply really is the missing complaint detail. A question
 * ("what's my GPA?") or an unrelated service request must be answered normally
 * and must never be filed onto the open complaint.
 */
export function isComplaintDetailReply(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 3) return false;
  if (NON_DETAIL_RE.test(t)) return false;
  if (QUESTION_RE.test(t)) return false;
  if (OTHER_INTENT_RE.test(t)) return false;
  return true;
}


/**
 * Adds the student's missing detail to the open case, re-classifies it with
 * the fuller picture, re-routes, re-assigns, notifies staff and returns the
 * acknowledgement with reference, status and the responsible staff member.
 */
export async function applyComplaintDetail(opts: {
  userId: string;
  lang: Lang;
  state: ComplaintIntakeState;
  detail: string;
}): Promise<ComplaintDetailResult | null> {
  const ar = opts.lang === "ar";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, student_id, title, description, status")
    .eq("id", opts.state.caseId)
    .maybeSingle();
  if (!row || row.student_id !== opts.userId) return null;

  const description = `${row.description ?? ""}\n\n${opts.detail}`.trim().slice(0, 8000);
  const classification = classifyInteraction({
    title: row.title,
    description,
    shortcutHint: "complaint",
  });
  const structured = structureComplaint({
    title: row.title,
    description,
    priority: classification.priority,
  });

  await supabaseAdmin
    .from("cases")
    .update({
      description,
      urgency: classification.priority as never,
      severity: classification.severity,
      routing_service_code: classification.serviceCode,
      routing_topic: classification.topic,
      routing_reason_en: classification.reasonEn,
      routing_reason_ar: classification.reasonAr,
      routing_confidence: classification.confidence,
      structured_details: structured as never,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  await supabaseAdmin.from("case_comments").insert({
    case_id: row.id,
    author_id: opts.userId,
    body: opts.detail.slice(0, 4000),
    is_internal: false,
  });

  // Classification → routing → assignment → SLA → staff notification, with the
  // complete picture this time. The case, its reference and its history stay
  // exactly the same.
  try {
    const { intakeCase } = await import("@/lib/automation/case-manager.server");
    await intakeCase(row.id);
  } catch {
    /* the scheduled sweep retries intake */
  }

  const { data: fresh } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, status, assigned_to, service_unit_id")
    .eq("id", row.id)
    .maybeSingle();

  const [unitRes, staffRes] = await Promise.all([
    fresh?.service_unit_id
      ? supabaseAdmin
          .from("service_units")
          .select("name_en, name_ar, contact_email")
          .eq("id", fresh.service_unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fresh?.assigned_to
      ? supabaseAdmin
          .from("profiles")
          .select("full_name, email")
          .eq("id", fresh.assigned_to)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const unit = unitRes.data as { name_en?: string; name_ar?: string; contact_email?: string } | null;
  const staff = staffRes.data as { full_name?: string; email?: string } | null;
  const unitName = (ar ? unit?.name_ar : unit?.name_en) ?? (ar ? opts.state.unitAr : opts.state.unitEn);
  const staffName = staff?.full_name ?? null;
  const staffEmail = staff?.email ?? unit?.contact_email ?? null;
  const reference = fresh?.case_number ?? row.case_number;

  const lines = ar
    ? [
        "شكراً — أضفت هذه التفاصيل إلى الشكوى نفسها ولم أنشئ طلباً جديداً.",
        "",
        `- الرقم المرجعي: ${reference}`,
        `- الحالة: ${statusLabel(fresh?.status ?? "submitted", "ar")}`,
        `- الجهة المسؤولة: ${unitName}`,
        staffName ? `- الموظف المسؤول: ${staffName}${staffEmail ? ` (${staffEmail})` : ""}` : `- الإحالة: في طابور ${unitName}`,
        "",
        "تم إشعار الجهة المسؤولة، وسأبلغك بأي تحديث على هذا الطلب.",
      ]
    : [
        "Thank you — I added this to the same complaint, so nothing was filed twice.",
        "",
        `- Reference: ${reference}`,
        `- Status: ${statusLabel(fresh?.status ?? "submitted", "en")}`,
        `- Responsible unit: ${unitName}`,
        staffName
          ? `- Responsible staff member: ${staffName}${staffEmail ? ` (${staffEmail})` : ""}`
          : `- Handling: queued with ${unitName}`,
        "",
        "The responsible team has been notified, and I will keep you updated on this request.",
      ];

  return {
    answer: lines.filter(Boolean).join("\n"),
    caseId: row.id,
    reference,
    trackingUrl: `/requests/${row.id}`,
  };
}

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  submitted: { en: "Submitted", ar: "تم الإرسال" },
  acknowledged: { en: "Acknowledged", ar: "تم الاستلام" },
  assigned: { en: "Assigned", ar: "تمت الإحالة" },
  routed: { en: "Routed to the unit", ar: "تمت الإحالة إلى الجهة" },
  classified: { en: "Classified", ar: "تم التصنيف" },
  in_review: { en: "In review", ar: "قيد المراجعة" },
  in_progress: { en: "In progress", ar: "قيد المعالجة" },
  resolved: { en: "Resolved", ar: "تم الحل" },
  closed: { en: "Closed", ar: "مغلق" },
};

export function statusLabel(status: string, lang: Lang): string {
  const hit = STATUS_LABELS[status];
  return hit ? hit[lang] : status.replace(/_/g, " ");
}
