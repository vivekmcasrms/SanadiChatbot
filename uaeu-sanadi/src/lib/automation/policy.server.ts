/**
 * Agent autonomy policy resolution.
 * "AI operates by default, humans supervise by exception" — this module decides,
 * for one concrete action on one concrete case, whether the AI may act alone.
 * Server only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AutonomyLevel = "automatic" | "automatic_notify" | "owner_approval" | "human_only";

export const ACTION_KEYS = [
  "classification",
  "routing",
  "assignment",
  "sla_calculation",
  "acknowledgement",
  "missing_information_request",
  "reminder",
  "status_update",
  "sla_escalation",
  "student_notification",
  "draft_response",
  "response_sending",
  "resolution_preparation",
  "resolution_sending",
  "case_closure",
] as const;

export type ActionKey = (typeof ACTION_KEYS)[number];

export const ACTION_LABELS: Record<ActionKey, { en: string; ar: string }> = {
  classification: { en: "Classification", ar: "التصنيف" },
  routing: { en: "Routing", ar: "التوجيه" },
  assignment: { en: "Assignment", ar: "الإسناد" },
  sla_calculation: { en: "SLA calculation", ar: "احتساب مستوى الخدمة" },
  acknowledgement: { en: "Acknowledgement", ar: "الإقرار بالاستلام" },
  missing_information_request: { en: "Missing-information request", ar: "طلب المعلومات الناقصة" },
  reminder: { en: "Reminder", ar: "التذكير" },
  status_update: { en: "Status update", ar: "تحديث الحالة" },
  sla_escalation: { en: "SLA escalation", ar: "تصعيد مستوى الخدمة" },
  student_notification: { en: "Student notification", ar: "إشعار الطالب" },
  draft_response: { en: "Draft response", ar: "إعداد مسودة الرد" },
  response_sending: { en: "Response sending", ar: "إرسال الرد" },
  resolution_preparation: { en: "Resolution preparation", ar: "إعداد الحل" },
  resolution_sending: { en: "Resolution sending", ar: "إرسال الحل" },
  case_closure: { en: "Case closure", ar: "إغلاق الحالة" },
};

export const AUTONOMY_ORDER: AutonomyLevel[] = ["automatic", "automatic_notify", "owner_approval", "human_only"];

/** Autonomy bands A–D as described in the operating model. */
export const AUTONOMY_BAND: Record<AutonomyLevel, "A" | "B" | "C" | "D"> = {
  automatic: "A",
  automatic_notify: "B",
  owner_approval: "C",
  human_only: "D",
};

function stricter(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return AUTONOMY_ORDER.indexOf(a) >= AUTONOMY_ORDER.indexOf(b) ? a : b;
}

export type PolicyContext = {
  caseType?: string | null;
  serviceUnitId?: string | null;
  isSensitive?: boolean;
  riskLevel?: string | null;
  confidence?: number | null;
  /** The case owner, whose personal preferences may tighten (never loosen) automation. */
  ownerId?: string | null;
};

export type AutonomyDecision = {
  action: ActionKey;
  level: AutonomyLevel;
  band: "A" | "B" | "C" | "D";
  canExecute: boolean;
  needsOwnerVisibility: boolean;
  policyId: string | null;
  minConfidence: number;
  reason: string;
};

/** Owner preferences may only tighten automation, never widen it beyond system policy. */
const PREF_GATES: Partial<Record<ActionKey, keyof OwnerPreferences>> = {
  student_notification: "auto_send_routine_updates",
  status_update: "auto_send_routine_updates",
  missing_information_request: "auto_request_missing_information",
  reminder: "auto_follow_up",
  sla_escalation: "auto_escalate_by_policy",
  resolution_preparation: "auto_prepare_resolution",
  case_closure: "auto_close_eligible_cases",
};

export type OwnerPreferences = {
  auto_send_routine_updates: boolean;
  auto_request_missing_information: boolean;
  auto_follow_up: boolean;
  auto_escalate_by_policy: boolean;
  auto_prepare_resolution: boolean;
  auto_close_eligible_cases: boolean;
  require_review_for_all_student_messages: boolean;
  preferred_response_style: string;
};

export const DEFAULT_OWNER_PREFERENCES: OwnerPreferences = {
  auto_send_routine_updates: true,
  auto_request_missing_information: true,
  auto_follow_up: true,
  auto_escalate_by_policy: true,
  auto_prepare_resolution: true,
  auto_close_eligible_cases: false,
  require_review_for_all_student_messages: false,
  preferred_response_style: "concise_formal",
};

export async function loadOwnerPreferences(ownerId: string | null | undefined): Promise<OwnerPreferences> {
  if (!ownerId) return DEFAULT_OWNER_PREFERENCES;
  const { data } = await supabaseAdmin
    .from("service_owner_ai_preferences")
    .select(
      "auto_send_routine_updates, auto_request_missing_information, auto_follow_up, auto_escalate_by_policy, auto_prepare_resolution, auto_close_eligible_cases, require_review_for_all_student_messages, preferred_response_style",
    )
    .eq("staff_profile_id", ownerId)
    .maybeSingle();
  return data ? { ...DEFAULT_OWNER_PREFERENCES, ...data } : DEFAULT_OWNER_PREFERENCES;
}

const STUDENT_MESSAGE_ACTIONS: ActionKey[] = [
  "student_notification",
  "response_sending",
  "missing_information_request",
  "reminder",
];

/**
 * Resolve the autonomy level for one action.
 * The strictest matching policy row wins, so sensitive / level-3 overrides can never be
 * loosened by a more specific unit rule.
 */
export async function resolveAutonomy(action: ActionKey, ctx: PolicyContext): Promise<AutonomyDecision> {
  const { data: rows } = await supabaseAdmin
    .from("automation_policies")
    .select("id, action_key, case_type, service_unit_id, risk_level, applies_to_sensitive, autonomy_level, min_confidence")
    .eq("action_key", action)
    .eq("is_active", true)
    .limit(100);

  const applicable = (rows ?? []).filter((r) => {
    if (r.applies_to_sensitive && !ctx.isSensitive) return false;
    if (r.case_type && r.case_type !== ctx.caseType) return false;
    if (r.service_unit_id && r.service_unit_id !== ctx.serviceUnitId) return false;
    if (r.risk_level && r.risk_level !== ctx.riskLevel) return false;
    return true;
  });

  let level: AutonomyLevel = "automatic";
  let policyId: string | null = null;
  let minConfidence = 0;
  let reason = "Default policy";

  for (const row of applicable) {
    const rowLevel = row.autonomy_level as AutonomyLevel;
    const next = stricter(level, rowLevel);
    if (next === rowLevel && (policyId === null || next !== level)) {
      policyId = row.id;
      reason = row.applies_to_sensitive
        ? "Sensitive case policy"
        : row.risk_level
          ? `Risk policy (${row.risk_level})`
          : row.service_unit_id
            ? "Service unit policy"
            : "Configured policy";
    }
    minConfidence = Math.max(minConfidence, Number(row.min_confidence ?? 0));
    level = next;
  }

  // Confidence gate: low-confidence work is never executed silently.
  const confidence = ctx.confidence ?? null;
  if (confidence != null && minConfidence > 0 && confidence < minConfidence && level !== "human_only") {
    level = stricter(level, "owner_approval");
    reason = `AI confidence ${confidence.toFixed(2)} below required ${minConfidence.toFixed(2)}`;
  }

  // Owner preferences may tighten automation for their own unit's cases.
  const prefs = await loadOwnerPreferences(ctx.ownerId ?? null);
  const gate = PREF_GATES[action];
  if (gate && prefs[gate] === false && level !== "human_only") {
    level = stricter(level, "owner_approval");
    reason = "Service Owner preference requires review";
  }
  if (prefs.require_review_for_all_student_messages && STUDENT_MESSAGE_ACTIONS.includes(action)) {
    level = stricter(level, "owner_approval");
    reason = "Service Owner reviews all student messages";
  }

  return {
    action,
    level,
    band: AUTONOMY_BAND[level],
    canExecute: level === "automatic" || level === "automatic_notify",
    needsOwnerVisibility: level !== "automatic",
    policyId,
    minConfidence,
    reason,
  };
}

export type AutomationEventInput = {
  caseId?: string | null;
  entityType?: string;
  entityId?: string | null;
  action: ActionKey | string;
  agent?: string;
  actorType?: "ai" | "system" | "human";
  actorId?: string | null;
  decision?: AutonomyDecision | null;
  ruleUsed?: string | null;
  inputs?: Record<string, unknown>;
  result?: Record<string, unknown>;
  confidence?: number | null;
  riskLevel?: string | null;
  executed?: boolean;
  summaryEn?: string;
  summaryAr?: string;
};

/** Every automated action is written to the audit trail — no invisible automation. */
export async function recordAutomationEvent(input: AutomationEventInput): Promise<void> {
  try {
    await supabaseAdmin.from("automation_events").insert({
      case_id: input.caseId ?? null,
      entity_type: input.entityType ?? "case",
      entity_id: input.entityId ?? input.caseId ?? null,
      action_key: input.action,
      agent: input.agent ?? "ai_case_manager",
      actor_type: input.actorType ?? "ai",
      actor_id: input.actorId ?? null,
      autonomy_level: input.decision?.level ?? "automatic",
      policy_id: input.decision?.policyId ?? null,
      rule_used: input.ruleUsed ?? input.decision?.reason ?? null,
      inputs: (input.inputs ?? {}) as never,
      result: (input.result ?? {}) as never,
      confidence: input.confidence ?? null,
      risk_level: (input.riskLevel ?? null) as never,
      human_review_required: input.decision ? !input.decision.canExecute : false,
      executed: input.executed ?? true,
      summary_en: input.summaryEn ?? null,
      summary_ar: input.summaryAr ?? null,
    });
  } catch (err) {
    console.error("[automation] audit write failed", err);
  }
}