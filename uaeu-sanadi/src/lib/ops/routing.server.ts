import { activeRoleHolders, filterActiveUsers } from "@/lib/authz/roles.server";
/** Rule-based routing + workload-balanced assignment. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applySlaToCase } from "./sla.server";
import { emitNotification } from "./notify.server";
import { classifyForRouting, SERVICE_UNIT_CODES, type ServiceCode } from "./classify.server";
import {
  ASSIGNMENT_METHOD_ADMIN,
  ASSIGNMENT_METHOD_ROUND_ROBIN,
  ASSIGNMENT_METHOD_RULE,
  ASSIGNMENT_METHOD_SERVICE_DESK,
  ASSIGNMENT_METHOD_WORKLOAD,
  recordAssignment,
  responsiblePersonFor,
  selectAssignee,
} from "./assignment.server";

type Conditions = Record<string, unknown>;

type CaseRow = {
  id: string;
  case_number: string;
  case_type: string;
  title: string;
  description: string | null;
  category_id: string | null;
  university_service_id: string | null;
  sensitivity_level: string;
  is_sensitive: boolean;
  urgency: string;
  language: string;
  service_unit_id: string | null;
  student_id: string;
  ai_confidence: number | null;
  routing_service_code?: string | null;
  routing_topic?: string | null;
  root_cause_code?: string | null;
};

/** Resolve the service family to the concrete unit that owns it. */
async function unitForService(service: ServiceCode): Promise<string | null> {
  const codes = SERVICE_UNIT_CODES[service] ?? [];
  if (!codes.length) return null;
  const { data } = await supabaseAdmin
    .from("service_units")
    .select("id, code")
    .in("code", codes)
    .eq("is_active", true);
  const rows = data ?? [];
  for (const code of codes) {
    const hit = rows.find((r) => r.code === code);
    if (hit) return hit.id;
  }
  return null;
}


function matches(conditions: Conditions, c: CaseRow): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    if (expected == null) continue;
    const actual = (c as unknown as Record<string, unknown>)[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Pick the best officer for a unit.
 * Thin wrapper kept for existing callers; the real logic lives in
 * assignment.server.ts so every surface balances workload the same way.
 */
export async function pickAssignee(
  unitId: string,
  method: string,
  caseRow: Pick<CaseRow, "id" | "is_sensitive" | "language">,
): Promise<string | null> {
  const pick = await selectAssignee({
    unitId,
    caseId: caseRow.id,
    isSensitive: caseRow.is_sensitive,
    method: method === "round_robin" ? ASSIGNMENT_METHOD_ROUND_ROBIN : ASSIGNMENT_METHOD_WORKLOAD,
  });
  return pick.staffId;
}


/**
 * Classify → route → assign a case, record the decision and apply SLA.
 * Safe to run more than once; the newest routing decision wins.
 */
export async function routeCase(caseId: string): Promise<{
  unitId: string | null;
  assigneeId: string | null;
  requiresHumanReview: boolean;
}> {
  const { data: c } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, case_type, title, description, category_id, university_service_id, sensitivity_level, is_sensitive, urgency, language, service_unit_id, student_id, ai_confidence",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!c) return { unitId: null, assigneeId: null, requiresHumanReview: true };
  const { data: hostelBooking } = await supabaseAdmin.from("hostel_bookings").select("case_id").eq("case_id", caseId).maybeSingle();

  // Confirm receipt to the student once, the moment the request enters routing.
  await emitNotification({
    eventType: "case_submitted",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    caseId,
    dedupeKey: `submitted:${caseId}`,
  });


  // 1. Understand the real owner of the problem before looking at any rule.
  const classification = classifyForRouting({ title: c.title, description: c.description });
  const caseRow = {
    ...(c as unknown as CaseRow),
    routing_service_code: classification.serviceCode,
    routing_topic: classification.topic,
    root_cause_code: classification.rootCauseCode,
  } as CaseRow;

  const { data: rules } = await supabaseAdmin
    .from("routing_rules")
    .select("id, priority, conditions, target_unit_id, target_staff_id, requires_human_review, assignment_method")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(200);

  // A rule must never pull a life-safety alert out of the emergency queue.
  const safetyCritical = classification.serviceCode === "safety_emergency";
  const matched = safetyCritical || hostelBooking
    ? null
    : ((rules ?? []).find((r) => matches((r.conditions ?? {}) as Conditions, caseRow)) ?? null);
  // Rule first, then the classified service family, then whatever the case already had.
  const classifiedUnitId = matched ? null : await unitForService(classification.serviceCode);
  const unitId = hostelBooking ? caseRow.service_unit_id : matched?.target_unit_id ?? classifiedUnitId ?? caseRow.service_unit_id ?? null;
  const method = matched?.assignment_method ?? "lowest_workload";
  // Low-confidence routing is never silently trusted: the owner verifies it.
  const lowConfidence = classification.confidence < 0.6;
  const requiresHumanReview = Boolean(hostelBooking) || (matched?.requires_human_review ?? (caseRow.is_sensitive || lowConfidence));

  let assigneeId: string | null = matched?.target_staff_id ?? null;
  let assignmentMethod = assigneeId ? ASSIGNMENT_METHOD_RULE : null;
  let workloadAtAssignment: number | null = null;
  let needsAttention = false;
  // The unit that ends up owning the case: the service desk takes over when the
  // routed unit has nobody who can receive cases.
  let owningUnitId = unitId;
  if (!assigneeId && unitId) {
    const pick = await selectAssignee({
      unitId,
      caseId,
      isSensitive: caseRow.is_sensitive,
      method: method === "round_robin" ? ASSIGNMENT_METHOD_ROUND_ROBIN : ASSIGNMENT_METHOD_WORKLOAD,
    });
    assigneeId = hostelBooking && pick.fallbackUnitId ? null : pick.staffId;
    assignmentMethod = pick.method;
    workloadAtAssignment = pick.workload;
    needsAttention = pick.needsAdminAttention;
    if (pick.fallbackUnitId && !hostelBooking) owningUnitId = pick.fallbackUnitId;
  } else if (!unitId) {
    // Nothing matched a category at all: the service desk owns it.
    const { serviceDeskUnitId } = await import("./assignment.server");
    const deskId = await serviceDeskUnitId();
    if (deskId) {
      owningUnitId = deskId;
      const pick = await selectAssignee({ unitId: deskId, caseId, isSensitive: caseRow.is_sensitive });
      assigneeId = pick.staffId;
      assignmentMethod = pick.staffId ? ASSIGNMENT_METHOD_SERVICE_DESK : null;
      workloadAtAssignment = pick.workload;
      needsAttention = true;
    }
  }

  // An emergency must never end this function ownerless. If no specialist unit
  // could take it, the central service desk takes ownership, and failing that a
  // named manager does — a silent queue is not an acceptable outcome here.
  const criticalCase =
    safetyCritical ||
    caseRow.urgency === "critical" ||
    (caseRow.case_type === "alert" && caseRow.urgency === "high");
  let serviceDeskFallback = assignmentMethod === ASSIGNMENT_METHOD_SERVICE_DESK;
  if (!assigneeId && criticalCase) {
    const { serviceDeskUnitId } = await import("./assignment.server");
    const deskId = await serviceDeskUnitId();
    if (deskId && deskId !== owningUnitId) {
      const pick = await selectAssignee({ unitId: deskId, caseId, isSensitive: caseRow.is_sensitive });
      if (pick.staffId) {
        owningUnitId = deskId;
        assigneeId = pick.staffId;
        assignmentMethod = ASSIGNMENT_METHOD_SERVICE_DESK;
        workloadAtAssignment = pick.workload;
        needsAttention = true;
        serviceDeskFallback = true;
      }
    }
    if (!assigneeId) {
      const managerId = (await activeRoleHolders(["service_manager", "system_admin"]))[0] ?? null;
      if (managerId) {
        assigneeId = managerId;
        assignmentMethod = ASSIGNMENT_METHOD_ADMIN;
        needsAttention = true;
      }
    }
  }

  // Auditable record of the two recovery paths a student never sees: a case
  // without a responsible unit, and a unit with nobody free to take the case.
  if (!owningUnitId) {
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("missing_unit_assignment", {
      caseId,
      recovered: false,
      escalated: true,
      recoveryAction: "held_for_admin_unit_assignment",
      context: { serviceCode: classification.serviceCode, topic: classification.topic },
    });
  } else if (!assigneeId) {
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("staff_unavailable", {
      caseId,
      recovered: true,
      escalated: true,
      recoveryAction: "unit_queue_with_admin_attention",
      context: { unitId: owningUnitId },
    });
  }

  const confidenceScore = matched ? Math.max(0.9, classification.confidence) : classification.confidence;

  await supabaseAdmin.from("routing_decisions").insert({
    case_id: caseId,
    matched_rule_id: matched?.id ?? null,
    recommended_unit_id: unitId,
    final_unit_id: owningUnitId,
    recommended_staff_id: assigneeId,
    final_staff_id: assigneeId,
    confidence_score: confidenceScore,
    decided_by: "system",
  });

  // A case is never left silently unassigned: without an eligible person it
  // goes to the escalation queue and Admin is told.
  const unassigned = !assigneeId;

  await supabaseAdmin
    .from("cases")
    .update({
      service_unit_id: owningUnitId,
      assigned_to: assigneeId,
      status: assigneeId ? "assigned" : "escalated",
      human_review_required: requiresHumanReview || unassigned,
      routing_service_code: classification.serviceCode,
      routing_topic: classification.topic,
      root_cause_code: classification.rootCauseCode,
      routing_reason_en: classification.reasonEn,
      routing_reason_ar: classification.reasonAr,
      routing_confidence: confidenceScore,
      next_action_en: assigneeId
        ? serviceDeskFallback
          ? "Service Desk to take immediate ownership and coordinate with the specialist unit"
          : "Officer to acknowledge and review"
        : "Escalated: no staff member is currently available in the responsible unit",
      next_action_ar: assigneeId
        ? serviceDeskFallback
          ? "على مكتب الخدمة تولي المسؤولية فوراً والتنسيق مع الوحدة المختصة"
          : "على الموظف الإقرار والمراجعة"
        : "تم التصعيد: لا يوجد موظف متاح حالياً في الوحدة المسؤولة",
      attention_reason: unassigned
        ? "No eligible staff member was available for assignment"
        : serviceDeskFallback
          ? "Routed to the Service Desk because no specialist unit staff member could be assigned"
          : null,
      assignment_method: assignmentMethod,
      assigned_at: assigneeId ? new Date().toISOString() : null,
      workload_at_assignment: workloadAtAssignment,
      needs_assignment_attention: needsAttention || unassigned,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (assigneeId) {
    await recordAssignment({
      caseId,
      unitId: owningUnitId,
      staffId: assigneeId,
      method: assignmentMethod ?? ASSIGNMENT_METHOD_WORKLOAD,
      workload: workloadAtAssignment,
    });
  }

  await supabaseAdmin.from("case_status_history").insert({
    case_id: caseId,
    to_status: assigneeId ? "assigned" : "escalated",
    note: assigneeId
      ? classification.reasonEn
      : `${classification.reasonEn} — escalated because no eligible staff member was available`,
  });

  if (unassigned) {
    const admins = (await activeRoleHolders(["system_admin", "service_manager"], 50)).map((user_id) => ({ user_id }));
    for (const a of admins ?? []) {
      await emitNotification({
        eventType: "case_escalated",
        entityType: "case",
        entityId: caseId,
        recipientId: a.user_id,
        vars: { case_number: caseRow.case_number, level: 1 },
        actionUrl: `/requests/${caseId}`,
        dedupeKey: `unassigned:${caseId}:${a.user_id}`,
      });
    }
  }



  await applySlaToCase(caseId);

  if (assigneeId) {
    // Critical and high work is announced as urgent, with what it is about, so
    // the officer can act without opening a queue first.
    const urgent = caseRow.urgency === "critical" || caseRow.urgency === "high";
    await emitNotification({
      eventType: urgent ? "urgent_assignment" : "new_assignment",
      entityType: "case",
      entityId: caseId,
      recipientId: assigneeId,
      vars: {
        case_number: caseRow.case_number,
        urgency: caseRow.urgency,
        case_type: caseRow.case_type,
        title: caseRow.title,
        reported_at: new Date().toISOString(),
        // Only ever a real reported location; nothing is invented.
        location: caseRow.description?.match(/\b(room|lab|building|classroom|hostel)\b[^.\n]{0,40}/i)?.[0]
          ? ` · Location: ${caseRow.description.match(/\b(room|lab|building|classroom|hostel)\b[^.\n]{0,40}/i)![0].trim()}`
          : "",
        unit: (await responsiblePersonFor(caseId))?.unitName ?? "",
      },
      actionUrl: `/requests/${caseId}`,
      dedupeKey: `assign:${caseId}:${assigneeId}`,
    });

    // Tell the student exactly who is now following their request up.
    const person = await responsiblePersonFor(caseId);
    await emitNotification({
      eventType: "case_assigned",
      entityType: "case",
      entityId: caseId,
      recipientId: caseRow.student_id,
      language: (caseRow.language as "en" | "ar") ?? "en",
      vars: {
        case_number: caseRow.case_number,
        staff_name: person?.staffName ?? "",
        unit: person?.unitName ?? "",
        staff_email: person?.staffEmail ?? "",
      },
      actionUrl: `/requests/${caseId}`,
      dedupeKey: `assigned-student:${caseId}:${assigneeId}`,
    });
  }

  return { unitId, assigneeId, requiresHumanReview };
}

/** Escalate a case one level, honouring escalation_policies. */
export async function escalateCase(opts: {
  caseId: string;
  reason: string;
  triggerType: string;
  triggeredBy?: string | null;
}): Promise<boolean> {
  const { data: c } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, case_type, service_unit_id, assigned_to, escalation_level, student_id, language, resolution_due_at")
    .eq("id", opts.caseId)
    .maybeSingle();
  if (!c) return false;

  const nextLevel = Math.min(3, (c.escalation_level ?? 0) + 1);

  const { data: policies } = await supabaseAdmin
    .from("escalation_policies")
    .select("id, service_unit_id, case_type, trigger_type, escalation_level, target_unit_id, notify_student")
    .eq("is_active", true)
    .eq("escalation_level", nextLevel)
    .limit(50);

  const policy =
    (policies ?? []).find((p) => p.service_unit_id === c.service_unit_id && p.trigger_type === opts.triggerType) ??
    (policies ?? []).find((p) => p.service_unit_id === c.service_unit_id) ??
    (policies ?? []).find((p) => p.case_type === c.case_type) ??
    (policies ?? [])[0] ??
    null;

  const targetUnit = policy?.target_unit_id ?? c.service_unit_id;
  let newAssignee: string | null = null;
  if (targetUnit) {
    newAssignee = await pickAssignee(targetUnit, "lowest_workload", {
      id: c.id,
      is_sensitive: false,
      language: c.language,
    });
  }

  await supabaseAdmin.from("escalation_actions").insert({
    case_id: c.id,
    escalation_policy_id: policy?.id ?? null,
    escalation_level: nextLevel,
    previous_unit_id: c.service_unit_id,
    target_unit_id: targetUnit,
    previous_assignee_id: c.assigned_to,
    new_assignee_id: newAssignee,
    reason: opts.reason,
    triggered_by: opts.triggeredBy ?? null,
  });

  await supabaseAdmin
    .from("cases")
    .update({
      escalation_level: nextLevel,
      status: "escalated",
      sla_state: "escalated",
      service_unit_id: targetUnit,
      assigned_to: newAssignee ?? c.assigned_to,
      last_activity_at: new Date().toISOString(),
      next_action_en: "Escalation owner to review and respond",
      next_action_ar: "على مسؤول التصعيد المراجعة والرد",
    })
    .eq("id", c.id);

  await supabaseAdmin.from("case_status_history").insert({
    case_id: c.id,
    to_status: "escalated",
    note: `Escalated to level ${nextLevel}`,
  });

  if (policy?.notify_student !== false) {
    await emitNotification({
      eventType: "case_escalated",
      entityType: "case",
      entityId: c.id,
      recipientId: c.student_id,
      language: (c.language as "en" | "ar") ?? "en",
      vars: { case_number: c.case_number, level: nextLevel },
      actionUrl: `/requests/${c.id}`,
      dedupeKey: `escalate:${c.id}:${nextLevel}`,
    });
  }
  if (newAssignee) {
    await emitNotification({
      eventType: "new_assignment",
      entityType: "case",
      entityId: c.id,
      recipientId: newAssignee,
      vars: { case_number: c.case_number },
      dedupeKey: `escalate-assign:${c.id}:${nextLevel}`,
    });
  }

  // Refresh the handover package so the escalation owner inherits full context.
  const { buildHandoverSafely } = await import("./handover.server");
  await buildHandoverSafely(c.id);
  return true;
}