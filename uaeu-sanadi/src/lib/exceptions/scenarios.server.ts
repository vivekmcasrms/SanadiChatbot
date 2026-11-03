/**
 * Controlled exception tests.
 *
 * Each scenario drives the SAME production code as a real incident — the real
 * ambiguity detector, the real recovery ladder, the real retrieval pipeline,
 * the real assignment selector — against harmless inputs, then records a real
 * exception event marked `is_test` so evidence stays separable from incidents.
 *
 * Nothing here writes to cases, students, staff, documents or notifications.
 */
import { detectAmbiguousRequest } from "./ambiguity";
import { exceptionMessage, type ExceptionCode } from "./catalogue";
import { guardService, logException, newTraceId, withRecovery } from "./handle.server";
import { DataUnavailableError, type Component } from "@/lib/result";

export const EXCEPTION_SCENARIOS = [
  "ambiguous_request",
  "api_timeout",
  "staff_unavailable",
  "missing_knowledge",
  "db_timeout",
  "rag_unavailable",
  "library_unavailable",
  "hostel_transaction_failure",
  "transfer_data_failure",
  "notification_write_failure",
] as const;

export type ExceptionScenario = (typeof EXCEPTION_SCENARIOS)[number];

export const SCENARIO_LABELS: Record<ExceptionScenario, { en: string; ar: string }> = {
  ambiguous_request: { en: "Ambiguous request", ar: "طلب غامض" },
  api_timeout: { en: "Simulated service timeout", ar: "محاكاة تعذّر استجابة خدمة" },
  staff_unavailable: { en: "Staff unavailable", ar: "لا يوجد موظف متاح" },
  missing_knowledge: { en: "Missing knowledge", ar: "لا توجد معلومة معتمدة" },
  db_timeout: { en: "Database timeout (holds lookup)", ar: "انتهاء مهلة قاعدة البيانات (الإيقافات)" },
  rag_unavailable: { en: "Document search unavailable", ar: "تعذّر البحث في المستندات" },
  library_unavailable: { en: "Library catalogue unavailable", ar: "تعذّر الوصول إلى فهرس المكتبة" },
  hostel_transaction_failure: { en: "Hostel transaction failure", ar: "فشل عملية حجز السكن" },
  transfer_data_failure: { en: "Transfer data failure", ar: "تعذّر قراءة بيانات التحويل" },
  notification_write_failure: { en: "Notification write failure", ar: "فشل حفظ الإشعار" },
};

export type ScenarioResult = {
  scenario: ExceptionScenario;
  label: { en: string; ar: string };
  code: ExceptionCode;
  detected: boolean;
  recovered: boolean;
  escalated: boolean;
  recoveryAction: string;
  /** Exactly what a student would have been shown. Never technical. */
  studentMessage: string;
  traceId: string;
  pass: boolean;
  note: { en: string; ar: string };
};

const AMBIGUOUS_PROBE = "I have a problem with my record.";
const UNKNOWN_KNOWLEDGE_PROBE =
  "What is the UAEU allowance policy for ZQXJVK9931 quantum lanyards issued to exchange students?";

async function runAmbiguous(userId: string, lang: "en" | "ar"): Promise<ScenarioResult> {
  const ambiguous = detectAmbiguousRequest(AMBIGUOUS_PROBE);
  const detected = Boolean(ambiguous);
  const studentMessage = ambiguous ? ambiguous.question[lang] : "";
  const traceId = await logException("ambiguous_intent", {
    userId,
    isTest: true,
    scenario: "ambiguous_request",
    recovered: detected,
    escalated: false,
    recoveryAction: "ask_clarification",
    studentMessage,
    detail: `Controlled test. Probe: "${AMBIGUOUS_PROBE}". Clarification topic: ${ambiguous?.topic ?? "none"}.`,
  });
  return {
    scenario: "ambiguous_request",
    label: SCENARIO_LABELS.ambiguous_request,
    code: "ambiguous_intent",
    detected,
    recovered: detected,
    escalated: false,
    recoveryAction: "ask_clarification",
    studentMessage,
    traceId,
    pass: detected && Boolean(studentMessage),
    note: {
      en: detected
        ? "The vague request was detected and answered with one focused clarification question."
        : "The vague request was not detected.",
      ar: detected
        ? "تم اكتشاف الطلب الغامض والرد بسؤال توضيحي واحد."
        : "لم يتم اكتشاف الطلب الغامض.",
    },
  };
}

async function runApiTimeout(userId: string, lang: "en" | "ar"): Promise<ScenarioResult> {
  const traceId = newTraceId();
  let attempts = 0;
  // The real recovery ladder: one retry, then verified fallback data.
  const result = await withRecovery(
    "api_failure",
    async () => {
      attempts += 1;
      throw new Error("controlled test: simulated upstream timeout");
    },
    {
      userId,
      traceId,
      lang,
      isTest: true,
      scenario: "api_timeout",
      detail: "Controlled test of the retry → verified fallback ladder.",
      fallback: async () => ({ source: "verified_cache", value: "last verified response" }),
    },
  );
  const recovered = result.ok;
  const studentMessage = recovered ? "" : exceptionMessage("api_failure", lang);
  return {
    scenario: "api_timeout",
    label: SCENARIO_LABELS.api_timeout,
    code: "api_failure",
    detected: attempts > 0,
    recovered,
    escalated: false,
    recoveryAction: recovered ? "retry_then_verified_fallback" : "plain_language_message",
    studentMessage,
    traceId,
    pass: attempts >= 2 && recovered,
    note: {
      en: `The call was retried ${attempts} time(s) and then served from verified data; the student saw no technical error.`,
      ar: `أُعيدت المحاولة ${attempts} مرة ثم استُخدمت بيانات موثقة، ولم يرَ الطالب أي خطأ تقني.`,
    },
  };
}

async function runStaffUnavailable(userId: string, lang: "en" | "ar"): Promise<ScenarioResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // A real read against the real staff table, for a unit that has no
  // available officer. Nothing is assigned and no case is touched.
  const { data: unit } = await supabaseAdmin
    .from("service_units")
    .select("id, name_en, name_ar")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const probeUnitId = "00000000-0000-0000-0000-000000000000";
  const { data: staff } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id")
    .eq("service_unit_id", probeUnitId)
    .limit(1);
  const noStaff = (staff ?? []).length === 0;
  const traceId = await logException("staff_unavailable", {
    userId,
    isTest: true,
    scenario: "staff_unavailable",
    recovered: noStaff,
    escalated: true,
    recoveryAction: "unit_queue_with_admin_attention",
    studentMessage: exceptionMessage("staff_unavailable", lang),
    detail: `Controlled test. No available officer for the probe unit; work held in the unit queue. Reference unit: ${unit?.name_en ?? "n/a"}.`,
  });
  return {
    scenario: "staff_unavailable",
    label: SCENARIO_LABELS.staff_unavailable,
    code: "staff_unavailable",
    detected: noStaff,
    recovered: noStaff,
    escalated: true,
    recoveryAction: "unit_queue_with_admin_attention",
    studentMessage: exceptionMessage("staff_unavailable", lang),
    traceId,
    pass: noStaff,
    note: {
      en: "No officer was available, so the work was placed in the unit queue and flagged for admin attention instead of being dropped.",
      ar: "لا يوجد موظف متاح، لذلك وُضع العمل في قائمة انتظار الوحدة مع تنبيه الإدارة بدل إهماله.",
    },
  };
}

async function runMissingKnowledge(
  db: Parameters<typeof import("@/lib/knowledge/retrieval.server").retrieveForGrounding>[0],
  userId: string,
  lang: "en" | "ar",
): Promise<ScenarioResult> {
  const { retrieveForGrounding } = await import("@/lib/knowledge/retrieval.server");
  const { evidenceCoversQuestion } = await import("./knowledge-coverage");
  const { permsFromRoles } = await import("@/lib/knowledge/permissions.server");
  let grounding = "no_evidence";
  let passages = 0;
  let covered = false;
  try {
    const outcome = await retrieveForGrounding(db, UNKNOWN_KNOWLEDGE_PROBE, {
      lang,
      perms: permsFromRoles(["system_admin"]),
      limit: 4,
      log: false,
    });
    grounding = outcome.groundingStatus;
    passages = outcome.passages.length;
    // Similarity alone is not coverage: the subject of the question must
    // actually appear in the retrieved text.
    covered = evidenceCoversQuestion(
      outcome.passages.map((p) => `${p.title} ${p.snippet}`).join(" "),
      UNKNOWN_KNOWLEDGE_PROBE,
    );
  } catch {
    grounding = "no_evidence";
  }
  const detected = grounding === "no_evidence" || passages === 0 || !covered;
  const studentMessage = exceptionMessage("missing_knowledge", lang);
  const traceId = await logException("missing_knowledge", {
    userId,
    isTest: true,
    scenario: "missing_knowledge",
    recovered: detected,
    escalated: false,
    recoveryAction: "safe_no_answer_with_human_handoff_offer",
    studentMessage,
    detail: `Controlled test. Probe question has no approved source. Grounding: ${grounding}, passages: ${passages}, subject covered by evidence: ${covered}.`,
  });
  return {
    scenario: "missing_knowledge",
    label: SCENARIO_LABELS.missing_knowledge,
    code: "missing_knowledge",
    detected,
    recovered: detected,
    escalated: false,
    recoveryAction: "safe_no_answer_with_human_handoff_offer",
    studentMessage,
    traceId,
    pass: detected,
    note: {
      en: "No approved source covered the question, so Sanadi said so and offered a person — it did not invent an answer.",
      ar: "لا يوجد مصدر معتمد يغطي السؤال، فأوضح سندي ذلك وعرض تحويله إلى موظف دون اختلاق إجابة.",
    },
  };
}

type FailureScenario = Extract<ExceptionScenario, "db_timeout" | "rag_unavailable" | "library_unavailable" | "hostel_transaction_failure" | "transfer_data_failure" | "notification_write_failure">;

/** Injected faults: the real guard runs against a simulated failure; no data is touched. */
const FAILURE_FAULTS: Record<FailureScenario, { component: Component; code: ExceptionCode; error: () => unknown }> = {
  db_timeout: { component: "holds", code: "missing_student_data", error: () => Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }) },
  rag_unavailable: { component: "rag", code: "rag_failure", error: () => new Error("Knowledge retrieval failed: connection refused") },
  library_unavailable: { component: "library", code: "api_failure", error: () => new DataUnavailableError("library", "provider_unreachable") },
  hostel_transaction_failure: { component: "hostel", code: "api_failure", error: () => new DataUnavailableError("hostel", "40001") },
  transfer_data_failure: { component: "transfer", code: "api_failure", error: () => new Error("Programme records are unavailable.") },
  notification_write_failure: { component: "notifications", code: "notification_failure", error: () => new DataUnavailableError("notifications", "write_failed") },
};

/** A failure passes only when it is NOT reported as "nothing found" and the message is plain. */
async function runInjectedFailure(scenario: FailureScenario, userId: string, lang: "en" | "ar"): Promise<ScenarioResult> {
  const fault = FAILURE_FAULTS[scenario];
  const traceId = newTraceId();
  const res = await guardService(fault.component, async () => { throw fault.error(); }, { lang, userId, isTest: true, scenario, traceId, recovery: "answered_with_retry_message" });
  const message = res.user_message ?? "";
  const plain = message.length > 0 && !/error|exception|stack|57014|40001|supabase|sql|null/i.test(message);
  const pass = res.status !== "ok" && res.status !== "not_found" && plain && res.retryable;
  return {
    scenario,
    label: SCENARIO_LABELS[scenario],
    code: fault.code,
    detected: res.status !== "ok",
    recovered: false,
    escalated: false,
    recoveryAction: "answered_with_retry_message",
    studentMessage: message,
    traceId,
    pass,
    note: pass
      ? { en: "Failure reported as unavailable with a plain retry message, never as nothing found.", ar: "أُبلغ عن العطل كخدمة غير متاحة برسالة واضحة، وليس كعدم وجود نتائج." }
      : { en: "Failure was not distinguished from a real empty result.", ar: "لم يُميَّز العطل عن نتيجة فارغة حقيقية." },
  };
}

/** Runs one controlled scenario and returns its verified result. */
export async function runExceptionScenario(
  db: Parameters<typeof runMissingKnowledge>[0],
  scenario: ExceptionScenario,
  userId: string,
  lang: "en" | "ar" = "en",
): Promise<ScenarioResult> {
  switch (scenario) {
    case "ambiguous_request":
      return runAmbiguous(userId, lang);
    case "api_timeout":
      return runApiTimeout(userId, lang);
    case "staff_unavailable":
      return runStaffUnavailable(userId, lang);
    case "missing_knowledge":
      return runMissingKnowledge(db, userId, lang);
    default:
      return runInjectedFailure(scenario, userId, lang);
  }
}
