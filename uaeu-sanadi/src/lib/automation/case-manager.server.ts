/**
 * AI Case Manager.
 *
 * Owns the routine administration of every case from submission to closure:
 * classification, routing, SLA, acknowledgement, missing information, follow-ups,
 * escalation, status transitions and closure recommendations.
 *
 * Everything here runs from database state and scheduled jobs — a Service Owner
 * never has to open a case for automation to happen. Server only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeCase, escalateCase } from "@/lib/ops/routing.server";
import { applySlaToCase, deriveSlaState } from "@/lib/ops/sla.server";
import { emitNotification, notifyUnitStaff } from "@/lib/ops/notify.server";
import { recordAutomationEvent, resolveAutonomy, type ActionKey, type AutonomyDecision } from "./policy.server";

export type AiCaseStatus =
  | "managing_automatically"
  | "waiting_for_student"
  | "preparing_follow_up"
  | "sla_monitoring"
  | "human_decision_needed"
  | "approval_needed"
  | "automation_paused"
  | "completed";

export type AttentionCategory =
  | "decision_required"
  | "approval_required"
  | "sensitive"
  | "student_disputed"
  | "low_confidence"
  | "policy_conflict"
  | "sla_critical"
  | "escalation_review"
  | "resolution_approval"
  | "unable_to_automate";

type CaseRow = {
  id: string;
  case_number: string;
  student_id: string;
  case_type: string;
  title: string;
  description: string;
  status: string;
  urgency: string;
  language: string;
  service_unit_id: string | null;
  assigned_to: string | null;
  is_sensitive: boolean;
  ai_confidence: number | null;
  escalation_level: number;
  first_response_at: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  sla_paused_at: string | null;
  created_at: string;
  last_activity_at: string | null;
};

const CASE_FIELDS =
  "id, case_number, student_id, case_type, title, description, status, urgency, language, service_unit_id, assigned_to, is_sensitive, ai_confidence, escalation_level, first_response_at, first_response_due_at, resolution_due_at, sla_paused_at, created_at, last_activity_at";

export async function loadAutomationCase(caseId: string): Promise<CaseRow | null> {
  const { data } = await supabaseAdmin.from("cases").select(CASE_FIELDS).eq("id", caseId).maybeSingle();
  return (data as CaseRow) ?? null;
}

async function decide(action: ActionKey, c: CaseRow): Promise<AutonomyDecision> {
  return resolveAutonomy(action, {
    caseType: c.case_type,
    serviceUnitId: c.service_unit_id,
    isSensitive: c.is_sensitive,
    confidence: c.ai_confidence != null ? Number(c.ai_confidence) : null,
    ownerId: c.assigned_to,
  });
}

export async function upsertAutomationState(
  caseId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin
    .from("case_automation_state")
    .upsert({ case_id: caseId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "case_id" });
}

async function isPaused(caseId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("case_automation_state")
    .select("automation_paused")
    .eq("case_id", caseId)
    .maybeSingle();
  return Boolean(data?.automation_paused);
}

/* ------------------------------------------------------------------ */
/* Classification and missing information                              */
/* ------------------------------------------------------------------ */

const SENSITIVE_PATTERNS =
  /(harass|discriminat|assault|abuse|threat|misconduct|bully|تحرش|تمييز|اعتداء|تهديد|إساءة)/i;
const URGENT_PATTERNS = /(urgent|deadline|today|tomorrow|exam|graduation|deport|visa|عاجل|غدا|اليوم|امتحان|تخرج)/i;

/** Requirement templates: what a complete request of this kind must contain. */
const REQUIREMENTS: { match: RegExp; items: { key: string; en: string; ar: string; test: RegExp }[] }[] = [
  {
    match: /(bus|transport|shuttle|حافلة|باص|نقل|مواصلات)/i,
    items: [
      { key: "route", en: "the bus route or line", ar: "خط الحافلة", test: /(route|line|from|to|خط|من|إلى)/i },
      { key: "time", en: "the approximate time", ar: "الوقت التقريبي", test: /(\d{1,2}\s*[:.]\s*\d{2}|\d{1,2}\s?(am|pm)|صباح|مساء)/i },
      { key: "date", en: "the date of the incident", ar: "تاريخ الواقعة", test: /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|yesterday|today|monday|tuesday|wednesday|thursday|sunday|أمس|اليوم)/i },
    ],
  },
  {
    match: /(hostel|housing|dorm|سكن|مبنى)/i,
    items: [
      { key: "building", en: "the building or room number", ar: "رقم المبنى أو الغرفة", test: /(building|room|block|مبنى|غرفة)/i },
      { key: "date", en: "the date the issue started", ar: "تاريخ بدء المشكلة", test: /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|since|منذ|بتاريخ)/i },
    ],
  },
  {
    match: /(course|registration|section|register|تسجيل|مقرر|شعبة)/i,
    items: [
      { key: "course_code", en: "the course code", ar: "رمز المقرر", test: /[A-Z]{2,4}\s?\d{3}/ },
      { key: "term", en: "the academic term", ar: "الفصل الدراسي", test: /(fall|spring|summer|term|semester|فصل|خريف|ربيع)/i },
    ],
  },
  {
    match: /(fee|payment|invoice|refund|رسوم|دفع|فاتورة|استرداد)/i,
    items: [
      { key: "amount", en: "the amount concerned", ar: "المبلغ المعني", test: /(\d[\d,.]*\s?(aed|درهم)|\bAED\b|درهم)/i },
      { key: "reference", en: "the payment reference or date", ar: "رقم أو تاريخ الدفع", test: /(\d{4}-\d{2}-\d{2}|ref|receipt|إيصال|مرجع)/i },
    ],
  },
];

/** Detect only genuinely missing items — never ask for what the student already provided. */
export function detectMissingInformation(c: Pick<CaseRow, "title" | "description">): { key: string; en: string; ar: string }[] {
  const text = `${c.title}\n${c.description}`;
  const template = REQUIREMENTS.find((r) => r.match.test(text));
  if (!template) return [];
  return template.items
    .filter((item) => !item.test.test(text))
    .map(({ key, en, ar }) => ({ key, en, ar }));
}

/** Deterministic classification signals used when the AI orchestrator did not set them. */
export function classifyCase(c: Pick<CaseRow, "title" | "description" | "urgency" | "is_sensitive">) {
  const text = `${c.title}\n${c.description}`;
  const sensitive = c.is_sensitive || SENSITIVE_PATTERNS.test(text);
  const urgency = c.urgency && c.urgency !== "medium" ? c.urgency : URGENT_PATTERNS.test(text) ? "high" : "medium";
  const arabic = /[\u0600-\u06FF]/.test(text);
  const confidence = sensitive ? 0.95 : /[.!؟?]/.test(text) && text.length > 60 ? 0.86 : 0.7;
  return { sensitive, urgency, language: arabic ? "ar" : "en", confidence };
}

/* ------------------------------------------------------------------ */
/* Intake orchestration                                                */
/* ------------------------------------------------------------------ */

/**
 * Full automatic intake for a newly submitted case.
 * Idempotent: safe to call more than once for the same case.
 */
export async function intakeCase(caseId: string): Promise<{ ok: boolean; steps: string[] }> {
  const initial = await loadAutomationCase(caseId);
  if (!initial) return { ok: false, steps: [] };
  const steps: string[] = [];

  // 1. Understand — classification and sensitivity.
  const signals = classifyCase(initial);
  const classification = await decide("classification", initial);
  if (classification.canExecute) {
    await supabaseAdmin
      .from("cases")
      .update({
        urgency: signals.urgency as never,
        is_sensitive: signals.sensitive,
        sensitivity_level: signals.sensitive ? "restricted" : "normal",
        language: signals.language as never,
        ai_confidence: signals.confidence,
        human_review_required: signals.sensitive,
      })
      .eq("id", caseId);
    steps.push("classification");
  }
  await recordAutomationEvent({
    caseId,
    action: "classification",
    decision: classification,
    inputs: { title: initial.title },
    result: { ...signals },
    confidence: signals.confidence,
    summaryEn: `Classified as ${initial.case_type} · ${signals.urgency}${signals.sensitive ? " · sensitive" : ""}`,
    summaryAr: `تم التصنيف: ${initial.case_type} · ${signals.urgency}`,
  });

  const c = (await loadAutomationCase(caseId)) ?? initial;

  // 2. Route + assign + SLA.
  const routing = await decide("routing", c);
  let routed: Awaited<ReturnType<typeof routeCase>> | null = null;
  if (routing.canExecute) {
    routed = await routeCase(caseId);
    steps.push("routing", "assignment", "sla_calculation");
  } else {
    await applySlaToCase(caseId);
    steps.push("sla_calculation");
  }
  await recordAutomationEvent({
    caseId,
    action: "routing",
    decision: routing,
    result: { unitId: routed?.unitId ?? null, assigneeId: routed?.assigneeId ?? null },
    confidence: signals.confidence,
    summaryEn: routed?.unitId ? "Routed to the responsible unit and assigned an owner" : "Routing needs human review",
    summaryAr: routed?.unitId ? "تم التوجيه إلى الوحدة المسؤولة وإسناد مالك للخدمة" : "التوجيه يحتاج مراجعة بشرية",
    executed: Boolean(routed),
  });
  await recordAutomationEvent({
    caseId,
    action: "sla_calculation",
    result: { computed: true },
    summaryEn: "First-response and resolution deadlines calculated from the working calendar",
    summaryAr: "تم احتساب مواعيد أول رد والحل وفق تقويم العمل",
  });

  const afterRouting = (await loadAutomationCase(caseId)) ?? c;

  // 3. Acknowledge the student automatically.
  const ack = await decide("acknowledgement", afterRouting);
  if (ack.canExecute && !afterRouting.first_response_at) {
    await supabaseAdmin
      .from("cases")
      .update({
        status: afterRouting.status === "submitted" ? "acknowledged" : (afterRouting.status as never),
        first_response_at: new Date().toISOString(),
        next_action_en: "Your request is being handled by the responsible unit",
        next_action_ar: "يتم التعامل مع طلبك من قبل الوحدة المسؤولة",
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", caseId);
    await supabaseAdmin.from("case_status_history").insert({
      case_id: caseId,
      to_status: "acknowledged" as never,
      note: "Acknowledged automatically by the AI Case Manager",
    });
    await emitNotification({
      eventType: "case_acknowledged",
      entityType: "case",
      entityId: caseId,
      recipientId: afterRouting.student_id,
      language: (afterRouting.language as "en" | "ar") ?? "en",
      vars: { case_number: afterRouting.case_number },
      actionUrl: `/requests/${caseId}`,
      dedupeKey: `ai-ack:${caseId}`,
    });
    steps.push("acknowledgement");
    await recordAutomationEvent({
      caseId,
      action: "acknowledgement",
      decision: ack,
      summaryEn: "Student acknowledged automatically with expected timelines",
      summaryAr: "تم إشعار الطالب تلقائياً بالمواعيد المتوقعة",
    });
  }

  // 4. Detect and request missing information.
  const missing = detectMissingInformation(afterRouting);
  let awaitingStudent = false;
  if (missing.length) {
    const info = await decide("missing_information_request", afterRouting);
    await recordAutomationEvent({
      caseId,
      action: "missing_information_request",
      decision: info,
      result: { missing: missing.map((m) => m.key) },
      executed: info.canExecute,
      summaryEn: `Missing information detected: ${missing.map((m) => m.en).join(", ")}`,
      summaryAr: `معلومات ناقصة: ${missing.map((m) => m.ar).join("، ")}`,
    });
    if (info.canExecute) {
      const ar = afterRouting.language === "ar";
      const body = ar
        ? `لإكمال معالجة طلبك نحتاج: ${missing.map((m) => m.ar).join("، ")}.`
        : `To continue with your request we still need: ${missing.map((m) => m.en).join(", ")}.`;
      const dueAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
      await supabaseAdmin.from("case_information_requests").insert({
        case_id: caseId,
        information_required: body,
        reason: "Automatically detected by the AI Case Manager",
        due_at: dueAt,
        pauses_sla: true,
        status: "pending",
      });
      await supabaseAdmin
        .from("cases")
        .update({
          status: "awaiting_student" as never,
          sla_paused_at: new Date().toISOString(),
          sla_state: "paused",
          next_action_en: "Waiting for the missing details from you",
          next_action_ar: "بانتظار التفاصيل الناقصة منك",
        })
        .eq("id", caseId);
      await emitNotification({
        eventType: "information_requested",
        entityType: "case",
        entityId: caseId,
        recipientId: afterRouting.student_id,
        language: (afterRouting.language as "en" | "ar") ?? "en",
        vars: { case_number: afterRouting.case_number },
        actionUrl: `/requests/${caseId}`,
        dedupeKey: `ai-inforeq:${caseId}`,
      });
      awaitingStudent = true;
      steps.push("missing_information_request");
    }
  }

  // 5. Begin monitoring and schedule the next automated action.
  const sensitive = signals.sensitive;
  const nextAt = new Date(Date.now() + (awaitingStudent ? 48 : 24) * 3_600_000).toISOString();
  await upsertAutomationState(caseId, {
    ai_status: sensitive
      ? "human_decision_needed"
      : awaitingStudent
        ? "waiting_for_student"
        : "managing_automatically",
    ai_confidence: signals.confidence,
    next_action_key: sensitive ? null : awaitingStudent ? "reminder" : "status_update",
    next_action_en: sensitive
      ? "Waiting for a Service Owner decision"
      : awaitingStudent
        ? "Send a reminder for the missing information"
        : "Monitor SLA and prepare the response draft",
    next_action_ar: sensitive
      ? "بانتظار قرار مالك الخدمة"
      : awaitingStudent
        ? "إرسال تذكير بالمعلومات الناقصة"
        : "مراقبة مستوى الخدمة وإعداد مسودة الرد",
    next_action_at: sensitive ? null : nextAt,
    attention_category: sensitive ? "sensitive" : null,
    attention_reason_en: sensitive ? "Sensitive matter — human handling required" : null,
    attention_reason_ar: sensitive ? "موضوع حساس — يتطلب تدخلاً بشرياً" : null,
    last_automated_at: new Date().toISOString(),
  });

  if (sensitive) {
    await notifyUnitStaff(afterRouting.service_unit_id, afterRouting.assigned_to, {
      eventType: "case_status_changed",
      entityType: "case",
      entityId: caseId,
      vars: { case_number: afterRouting.case_number, status: "sensitive — human handling required" },
      actionUrl: `/cases`,
      dedupeKey: `ai-sensitive:${caseId}`,
    });
  }

  return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* Continuous management sweep                                         */
/* ------------------------------------------------------------------ */

type FollowUpPolicy = {
  id: string;
  waiting_state: string;
  case_type: string | null;
  service_unit_id: string | null;
  first_reminder_after_hours: number;
  second_reminder_after_hours: number | null;
  final_reminder_after_hours: number | null;
  escalation_after_hours: number | null;
  notify_student: boolean;
  notify_owner: boolean;
  notify_manager: boolean;
  maximum_reminders: number;
};

async function loadFollowUpPolicies(): Promise<FollowUpPolicy[]> {
  const { data } = await supabaseAdmin
    .from("follow_up_policies")
    .select(
      "id, waiting_state, case_type, service_unit_id, first_reminder_after_hours, second_reminder_after_hours, final_reminder_after_hours, escalation_after_hours, notify_student, notify_owner, notify_manager, maximum_reminders",
    )
    .eq("is_active", true)
    .eq("entity_type", "case")
    .limit(200);
  return (data ?? []) as FollowUpPolicy[];
}

function pickPolicy(policies: FollowUpPolicy[], waitingState: string, c: CaseRow): FollowUpPolicy | null {
  const candidates = policies.filter((p) => p.waiting_state === waitingState);
  return (
    candidates.find((p) => p.service_unit_id === c.service_unit_id && p.case_type === c.case_type) ??
    candidates.find((p) => p.service_unit_id === c.service_unit_id) ??
    candidates.find((p) => p.case_type === c.case_type) ??
    candidates[0] ??
    null
  );
}

function dueReminderIndex(policy: FollowUpPolicy, hoursWaiting: number): number {
  const marks = [
    policy.first_reminder_after_hours,
    policy.second_reminder_after_hours,
    policy.final_reminder_after_hours,
  ].filter((h): h is number => typeof h === "number");
  let idx = 0;
  for (const mark of marks) if (hoursWaiting >= mark) idx += 1;
  return Math.min(idx, policy.maximum_reminders);
}

const WAITING_STATES: Record<string, string> = {
  awaiting_student: "awaiting_student",
  student_confirmation: "awaiting_student",
  resolution_proposed: "awaiting_student",
};

/**
 * One pass of the AI Case Manager over all active cases.
 * Reminders, escalations, status transitions and attention flags are all idempotent.
 */
export async function runCaseManagerSweep(): Promise<{ processed: number; details: Record<string, number> }> {
  const { data: rows } = await supabaseAdmin
    .from("cases")
    .select(CASE_FIELDS)
    .eq("is_demo", false)
    .not("status", "in", "(closed,resolved,withdrawn,rejected,duplicate)")
    .limit(500);

  const policies = await loadFollowUpPolicies();
  const details: Record<string, number> = {
    reminders: 0,
    escalations: 0,
    resumed: 0,
    attention: 0,
    intake: 0,
    closureRecommended: 0,
    paused: 0,
  };
  const now = Date.now();

  for (const raw of rows ?? []) {
    const c = raw as CaseRow;
    const { data: state } = await supabaseAdmin
      .from("case_automation_state")
      .select("automation_paused, reminders_sent, ai_status")
      .eq("case_id", c.id)
      .maybeSingle();

    if (!state) {
      await intakeCase(c.id);
      details["intake"] = (details["intake"] ?? 0) + 1;
      continue;
    }
    if (state.automation_paused) {
      details["paused"] = (details["paused"] ?? 0) + 1;
      continue;
    }

    const slaState = deriveSlaState(c);
    const waitingState = WAITING_STATES[c.status] ?? "awaiting_internal_action";
    const anchor = new Date(c.last_activity_at ?? c.created_at).getTime();
    const hoursWaiting = (now - anchor) / 3_600_000;
    const policy = pickPolicy(policies, waitingState, c);

    let aiStatus: AiCaseStatus = "managing_automatically";
    let attention: AttentionCategory | null = null;
    let attentionEn: string | null = null;
    let attentionAr: string | null = null;
    let nextKey: string | null = "status_update";
    let nextEn = "Continue SLA monitoring";
    let nextAr = "متابعة مراقبة مستوى الخدمة";
    let nextAt: string | null = new Date(now + 24 * 3_600_000).toISOString();

    // -- Automatic follow-up -------------------------------------------------
    if (policy) {
      const wanted = dueReminderIndex(policy, hoursWaiting);
      const sent = state.reminders_sent ?? 0;
      if (wanted > sent) {
        const reminderDecision = await decide("reminder", c);
        if (reminderDecision.canExecute) {
          if (policy.notify_student) {
            await emitNotification({
              eventType: "information_requested",
              entityType: "case",
              entityId: c.id,
              recipientId: c.student_id,
              language: (c.language as "en" | "ar") ?? "en",
              vars: { case_number: c.case_number },
              actionUrl: `/requests/${c.id}`,
              dedupeKey: `ai-reminder:${c.id}:${wanted}`,
            });
          }
          if (policy.notify_owner || policy.notify_manager) {
            await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
              eventType: "sla_warning",
              entityType: "case",
              entityId: c.id,
              vars: { case_number: c.case_number, threshold: wanted },
              actionUrl: `/cases`,
              dedupeKey: `ai-reminder-staff:${c.id}:${wanted}`,
            });
          }
          await upsertAutomationState(c.id, { reminders_sent: wanted });
          await recordAutomationEvent({
            caseId: c.id,
            action: "reminder",
            decision: reminderDecision,
            ruleUsed: `follow_up_policy:${policy.id}`,
            result: { reminderNumber: wanted, waitingState },
            summaryEn: `Reminder ${wanted} sent automatically (${waitingState.replace(/_/g, " ")})`,
            summaryAr: `تم إرسال التذكير ${wanted} تلقائياً`,
          });
          details["reminders"] = (details["reminders"] ?? 0) + 1;
          aiStatus = "preparing_follow_up";
        }
      }

      // -- Rule-based escalation --------------------------------------------
      if (
        policy.escalation_after_hours != null &&
        hoursWaiting >= policy.escalation_after_hours &&
        (c.escalation_level ?? 0) < 3
      ) {
        const escDecision = await decide("sla_escalation", c);
        if (escDecision.canExecute) {
          const ok = await escalateCase({
            caseId: c.id,
            reason: `No movement for ${Math.round(hoursWaiting)}h in state ${waitingState}`,
            triggerType: "follow_up_policy",
          });
          if (ok) {
            details["escalations"] = (details["escalations"] ?? 0) + 1;
            await recordAutomationEvent({
              caseId: c.id,
              action: "sla_escalation",
              decision: escDecision,
              ruleUsed: `follow_up_policy:${policy.id}`,
              summaryEn: "Case escalated automatically after the configured waiting period",
              summaryAr: "تم تصعيد الحالة تلقائياً بعد انتهاء فترة الانتظار المحددة",
            });
          }
        } else {
          attention = "escalation_review";
          attentionEn = "Escalation recommended — your decision is required";
          attentionAr = "يوصى بالتصعيد — يتطلب قرارك";
        }
      }
    }

    // -- Attention triage ----------------------------------------------------
    if (c.is_sensitive) {
      attention = "sensitive";
      attentionEn = "Sensitive matter — human handling required";
      attentionAr = "موضوع حساس — يتطلب تدخلاً بشرياً";
      aiStatus = "human_decision_needed";
    } else if (slaState === "resolution_overdue" || slaState === "first_response_overdue") {
      attention = attention ?? "sla_critical";
      attentionEn = attentionEn ?? "SLA breached — intervention needed";
      attentionAr = attentionAr ?? "تم تجاوز مستوى الخدمة — يتطلب تدخلاً";
      aiStatus = "sla_monitoring";
    } else if (c.ai_confidence != null && Number(c.ai_confidence) < 0.5) {
      attention = "low_confidence";
      attentionEn = "AI confidence is low — please confirm classification and routing";
      attentionAr = "ثقة الذكاء الاصطناعي منخفضة — يرجى تأكيد التصنيف والتوجيه";
      aiStatus = "human_decision_needed";
    } else if (!c.service_unit_id || !c.assigned_to) {
      attention = "unable_to_automate";
      attentionEn = "No responsible unit or owner could be determined automatically";
      attentionAr = "تعذر تحديد الوحدة أو المالك تلقائياً";
      aiStatus = "human_decision_needed";
    }

    // -- Pending approvals ---------------------------------------------------
    const { count: approvals } = await supabaseAdmin
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("case_id", c.id)
      .eq("approval_status", "pending");
    if ((approvals ?? 0) > 0) {
      attention = "approval_required";
      attentionEn = "An approval is pending your decision";
      attentionAr = "هناك اعتماد بانتظار قرارك";
      aiStatus = "approval_needed";
    }

    // -- Closure recommendation ---------------------------------------------
    if (c.status === "resolution_proposed" && hoursWaiting > 24 * 7) {
      const closure = await decide("case_closure", c);
      attention = closure.canExecute ? attention : (attention ?? "resolution_approval");
      attentionEn = attentionEn ?? "Resolution accepted timeline elapsed — closure recommended";
      attentionAr = attentionAr ?? "انقضت مهلة قبول الحل — يوصى بالإغلاق";
      details["closureRecommended"] = (details["closureRecommended"] ?? 0) + 1;
      nextKey = "case_closure";
      nextEn = "Closure recommendation prepared for your approval";
      nextAr = "تم إعداد توصية الإغلاق لاعتمادك";
      nextAt = null;
    }

    if (c.status === "awaiting_student") {
      aiStatus = attention ? aiStatus : "waiting_for_student";
      nextKey = "reminder";
      nextEn = "Send the next reminder to the student";
      nextAr = "إرسال التذكير التالي للطالب";
      if (policy) nextAt = new Date(anchor + policy.first_reminder_after_hours * 3_600_000).toISOString();
    }

    if (attention) details["attention"] = (details["attention"] ?? 0) + 1;

    await upsertAutomationState(c.id, {
      ai_status: attention ? aiStatus : aiStatus,
      attention_category: attention,
      attention_reason_en: attentionEn,
      attention_reason_ar: attentionAr,
      next_action_key: nextKey,
      next_action_en: nextEn,
      next_action_ar: nextAr,
      next_action_at: nextAt,
      last_automated_at: new Date().toISOString(),
    });
  }

  return { processed: rows?.length ?? 0, details };
}

/* ------------------------------------------------------------------ */
/* Deterministic status transitions                                    */
/* ------------------------------------------------------------------ */

/**
 * Resume the workflow automatically when the student supplies what was missing.
 * Called from the student information-response path.
 */
export async function resumeAfterStudentInput(caseId: string): Promise<void> {
  const c = await loadAutomationCase(caseId);
  if (!c || (await isPaused(caseId))) return;
  const decision = await decide("status_update", c);
  if (!decision.canExecute) return;
  await upsertAutomationState(caseId, {
    ai_status: "managing_automatically",
    reminders_sent: 0,
    attention_category: null,
    attention_reason_en: null,
    attention_reason_ar: null,
    next_action_key: "draft_response",
    next_action_en: "Prepare the response draft for the Service Owner",
    next_action_ar: "إعداد مسودة الرد لمالك الخدمة",
    next_action_at: new Date(Date.now() + 3_600_000).toISOString(),
    last_automated_at: new Date().toISOString(),
  });
  await recordAutomationEvent({
    caseId,
    action: "status_update",
    decision,
    summaryEn: "Student information received — workflow resumed automatically",
    summaryAr: "تم استلام معلومات الطالب — استؤنف سير العمل تلقائياً",
  });
}

/* ------------------------------------------------------------------ */
/* Owner supervision controls                                          */
/* ------------------------------------------------------------------ */

export async function pauseAutomation(caseId: string, actorId: string, reason: string, pause: boolean) {
  await upsertAutomationState(caseId, {
    automation_paused: pause,
    pause_reason: pause ? reason : null,
    paused_by: pause ? actorId : null,
    paused_at: pause ? new Date().toISOString() : null,
    ai_status: pause ? "automation_paused" : "managing_automatically",
  });
  await recordAutomationEvent({
    caseId,
    action: "status_update",
    actorType: "human",
    actorId,
    ruleUsed: pause ? "owner_pause" : "owner_resume",
    inputs: { reason },
    summaryEn: pause ? `Automation paused by Service Owner: ${reason}` : "Automation resumed by Service Owner",
    summaryAr: pause ? `تم إيقاف الأتمتة من قبل مالك الخدمة: ${reason}` : "تم استئناف الأتمتة من قبل مالك الخدمة",
  });
  return { ok: true };
}

/** Service Owner overrides an AI decision. Reasons are mandatory and audited. */
export async function overrideCaseDecision(opts: {
  caseId: string;
  actorId: string;
  field: "unit" | "urgency" | "assignee" | "classification";
  value: string;
  reason: string;
}) {
  const c = await loadAutomationCase(opts.caseId);
  if (!c) throw new Error("Case not found");
  const patch: Record<string, unknown> = {};
  if (opts.field === "unit") patch["service_unit_id"] = opts.value;
  if (opts.field === "assignee") patch["assigned_to"] = opts.value;
  if (opts.field === "urgency") patch["urgency"] = opts.value;
  if (opts.field === "classification") patch["case_type"] = opts.value;
  patch["last_activity_at"] = new Date().toISOString();
  await supabaseAdmin.from("cases").update(patch as never).eq("id", opts.caseId);

  if (opts.field === "unit" || opts.field === "assignee") {
    await supabaseAdmin.from("routing_decisions").insert({
      case_id: opts.caseId,
      recommended_unit_id: c.service_unit_id,
      final_unit_id: opts.field === "unit" ? opts.value : c.service_unit_id,
      recommended_staff_id: c.assigned_to,
      final_staff_id: opts.field === "assignee" ? opts.value : c.assigned_to,
      decided_by: "human",
      override_reason: opts.reason,
    });
  }
  await recordAutomationEvent({
    caseId: opts.caseId,
    action: "routing",
    actorType: "human",
    actorId: opts.actorId,
    ruleUsed: "owner_override",
    inputs: { field: opts.field, value: opts.value, reason: opts.reason },
    summaryEn: `Service Owner overrode ${opts.field}: ${opts.reason}`,
    summaryAr: `قام مالك الخدمة بتجاوز ${opts.field}: ${opts.reason}`,
  });
  return { ok: true };
}