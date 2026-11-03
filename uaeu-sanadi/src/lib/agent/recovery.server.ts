/**
 * Intelligent recovery when live state moved between planning and execution.
 * Server only — deterministic, no model calls.
 *
 * A blocked write is classified, and where a safe alternative exists Sanadi
 * proposes it while preserving the student's original intent and preferences.
 */
import type { ProposedAction } from "../agent-types";
import type { Db } from "./tools.server";
import type { PreflightResult } from "./preflight.server";

export type RecoveryClassification =
  | "AUTO_RECOVERABLE"
  | "STUDENT_CONFIRMATION_REQUIRED"
  | "HUMAN_REVIEW_REQUIRED"
  | "CANNOT_CONTINUE";

export type RecoveryOutcome = {
  classification: RecoveryClassification;
  /** Student-facing, already translated, natural and non-technical. */
  message: string;
  /** Replacement the student can confirm, when one was found. */
  proposedAction: ProposedAction | null;
  /** Machine-readable summary for the audit trail. */
  detail: Record<string, unknown>;
};

const CLASSIFY: Record<string, RecoveryClassification> = {
  slot_unavailable: "AUTO_RECOVERABLE",
  service_closed: "CANNOT_CONTINUE",
  not_eligible: "CANNOT_CONTINUE",
  existing_assignment: "CANNOT_CONTINUE",
  duplicate_appointment: "CANNOT_CONTINUE",
  active_hold: "HUMAN_REVIEW_REQUIRED",
  student_not_active: "HUMAN_REVIEW_REQUIRED",
  policy_version_changed: "HUMAN_REVIEW_REQUIRED",
};

const PREAMBLE = {
  en: "Something changed just now, so I checked the latest information before continuing. ",
  ar: "تغيّر شيء ما للتو، لذلك تحققت من أحدث المعلومات قبل المتابعة. ",
};

/**
 * Decides what to do about a failed live re-check and, when it is safe,
 * finds the next-best option using the student's existing criteria.
 */
export async function recoverFromLiveChange(input: {
  db: Db;
  userId: string;
  lang: "en" | "ar";
  toolName: string;
  args: Record<string, unknown>;
  preflight: PreflightResult;
}): Promise<RecoveryOutcome> {
  const { db, userId, lang, toolName, args, preflight } = input;
  const code = preflight.code ?? "unknown";
  const base = CLASSIFY[code] ?? "CANNOT_CONTINUE";
  const changed = preflight.message ?? "";
  const pre = PREAMBLE[lang];

  if (base === "AUTO_RECOVERABLE" && preflight.policy?.recoveryMode !== "none") {
    const alt = await appointmentAlternative(db, lang, args);

    if (alt) {
      return {
        classification: alt.material ? "STUDENT_CONFIRMATION_REQUIRED" : "AUTO_RECOVERABLE",
        message: `${pre}${changed} ${alt.message}`,
        proposedAction: alt.action,
        detail: { code, recovery: "alternative_offered", material: alt.material, ...alt.detail },
      };
    }
    return {
      classification: "CANNOT_CONTINUE",
      message: `${pre}${changed} ${
        lang === "ar"
          ? "لا يوجد بديل مناسب متاح الآن. سأحتفظ بتفضيلاتك ويمكنني إبلاغك فور توفر خيار جديد."
          : "There is no suitable alternative open right now. I have kept your preferences and can tell you as soon as one opens."
      }`,
      proposedAction: null,
      detail: { code, recovery: "no_alternative" },
    };
  }

  if (base === "HUMAN_REVIEW_REQUIRED") {
    const caseId = await routeToAttention(db, userId, lang, toolName, code, changed);
    return {
      classification: "HUMAN_REVIEW_REQUIRED",
      message: `${pre}${changed} ${
        lang === "ar"
          ? "أحلت الأمر إلى الموظف المختص لمراجعته، وستجده ضمن «يحتاج انتباهك» في صفحة طلباتك."
          : "I have passed this to the responsible staff member to review, and you will find it under “Needs your attention” on your requests page."
      }`,
      proposedAction: null,
      detail: { code, recovery: "human_review", caseId },
    };
  }

  // CANNOT_CONTINUE — keep the student's progress and offer the natural next step.
  const tail =
    code === "service_closed"
      ? lang === "ar"
        ? "حفظت ما أنجزناه ويمكنني تذكيرك عند فتح الفترة القادمة."
        : "I saved your progress and can remind you when the next window opens."
      : lang === "ar"
        ? "أخبرني إذا رغبت في مراجعة الخيارات المتاحة الآن."
        : "Tell me if you would like to review the options that are open now.";

  return {
    classification: "CANNOT_CONTINUE",
    message: `${pre}${changed} ${tail}`,
    proposedAction: null,
    detail: { code, recovery: "blocked" },
  };
}

type Alternative = {
  action: ProposedAction;
  message: string;
  material: boolean;
  detail: Record<string, unknown>;
};

/** Offers the nearest remaining slots of the same appointment type. */
async function appointmentAlternative(
  db: Db,
  lang: "en" | "ar",
  args: Record<string, unknown>,
): Promise<Alternative | null> {
  const previousSlotId = String(args["slotId"] ?? "");
  const { data: previous } = await db
    .from("appointment_slots")
    .select("id, appointment_type_id, start_time")
    .eq("id", previousSlotId)
    .maybeSingle();
  if (!previous) return null;

  const { data: slots } = await db
    .from("appointment_slots")
    .select(
      "id, start_time, capacity, booked_count, status, appointment_types:appointment_type_id (name_en, name_ar)",
    )
    .eq("appointment_type_id", previous.appointment_type_id)
    .eq("status", "open")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const next = (slots ?? []).find((s) => s.id !== previousSlotId && s.booked_count < s.capacity);
  if (!next) return null;

  const when = new Date(next.start_time).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
    timeZone: "Asia/Dubai",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const label =
    lang === "ar" ? `حجز الموعد البديل: ${when}` : `Book the next available time: ${when}`;

  return {
    material: false,
    detail: { previousSlotId, alternativeSlotId: next.id, start: next.start_time },
    message:
      lang === "ar"
        ? `أقرب موعد متاح هو ${when}. هل أحجزه لك؟`
        : `The next available time is ${when}. Shall I book it for you?`,
    action: {
      key: "book_appointment",
      toolName: "book_appointment",
      labelEn: label,
      labelAr: label,
      risk: "level_2",
      affectedService: lang === "ar" ? "المواعيد" : "Appointments",
      dataShared:
        lang === "ar"
          ? "اسمك ورقمك الجامعي وسبب الموعد"
          : "Your name, student number and appointment purpose",
      expectedOutcome:
        lang === "ar" ? "تأكيد الموعد البديل" : "The alternative appointment is confirmed",
      args: { slotId: next.id, purpose: String(args["purpose"] ?? "") },
    },
  };
}

/** Opens a human-review case so the exception surfaces under “Needs your attention”. */
async function routeToAttention(
  db: Db,
  userId: string,
  lang: "en" | "ar",
  toolName: string,
  code: string,
  reason: string,
): Promise<string | null> {
  const { data } = await db
    .from("cases")
    .insert({
      case_number: "",
      student_id: userId,
      case_type: "service_request",
      title:
        lang === "ar"
          ? `مراجعة بشرية مطلوبة قبل تنفيذ: ${toolName}`
          : `Human review required before completing: ${toolName}`,
      description: `${reason}\n\n[revalidation: ${code}]`,
      status: "submitted",
      urgency: "high",
      language: lang,
      human_review_required: true,
      due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}
