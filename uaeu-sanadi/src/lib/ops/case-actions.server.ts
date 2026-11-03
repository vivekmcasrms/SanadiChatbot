import { DataUnavailableError } from "@/lib/result";
import { isEligibleAssignee, isStaleChange, STALE_MESSAGE } from "./staff-workspace";
import { checked } from "@/lib/exceptions/handle.server";
import { auditInsert } from "@/lib/exceptions/handle.server";
import { getActiveRoles } from "@/lib/authz/roles.server";
/** Closed-loop case lifecycle operations. All transitions are recorded and notified. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applySlaToCase } from "./sla.server";
import { emitNotification, notifyUnitStaff } from "./notify.server";
import { escalateCase, pickAssignee } from "./routing.server";

const STAFF_ROLES = [
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "system_admin",
  "auditor",
  "leadership_viewer",
];
const MANAGER_ROLES = ["service_manager", "system_admin"];

export async function getRoles(userId: string): Promise<string[]> {
  return getActiveRoles(supabaseAdmin, userId);
}

export async function assertStaff(userId: string): Promise<string[]> {
  const roles = await getRoles(userId);
  if (!roles.some((r) => STAFF_ROLES.includes(r))) throw new Error("Forbidden: staff access required");
  return roles;
}

/** Staff may act only on cases assigned to them or in units they are permitted for. */
export async function assertCaseAccess(caseId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("can_access_case", { _case_id: caseId, _user_id: userId });
  if (error) throw new DataUnavailableError("staff_operations", error.code || "access_check_failed");
  if (!data) throw new Error("Forbidden: this request is outside your units");
}

export async function assertManager(userId: string): Promise<string[]> {
  const roles = await getRoles(userId);
  if (!roles.some((r) => MANAGER_ROLES.includes(r))) throw new Error("Forbidden: manager access required");
  return roles;
}

type CaseCore = {
  id: string;
  case_number: string;
  student_id: string;
  language: string;
  status: string;
  service_unit_id: string | null;
  assigned_to: string | null;
  first_response_at: string | null;
  escalation_level: number;
};

export async function loadCase(caseId: string): Promise<CaseCore> {
  const { data } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, student_id, language, status, service_unit_id, assigned_to, first_response_at, escalation_level",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!data) throw new Error("Case not found");
  return data as CaseCore;
}

async function transition(opts: {
  caseId: string;
  status: string;
  actorId: string | null;
  note?: string | null | undefined;
  extra?: Record<string, unknown>;
  nextEn?: string | undefined;
  nextAr?: string | undefined;
}) {
  await checked(supabaseAdmin
    .from("cases")
    .update({
      status: opts.status as never,
      last_activity_at: new Date().toISOString(),
      ...(opts.nextEn ? { next_action_en: opts.nextEn } : {}),
      ...(opts.nextAr ? { next_action_ar: opts.nextAr } : {}),
      ...(opts.extra ?? {}),
    })
    .eq("id", opts.caseId), "staff_operations", "cases", true);

  await checked(supabaseAdmin.from("case_status_history").insert({
    case_id: opts.caseId,
    to_status: opts.status as never,
    changed_by: opts.actorId,
    note: opts.note ?? null,
  }), "staff_operations", "case_status_history", false);
}

/** Officer acknowledges a case; stamps first response for SLA purposes. */
export async function acknowledgeCase(caseId: string, actorId: string, note?: string) {
  const c = await loadCase(caseId);
  await transition({
    caseId,
    status: "acknowledged",
    actorId,
    note: note ?? null,
    extra: c.first_response_at ? {} : { first_response_at: new Date().toISOString() },
    nextEn: "Officer is reviewing your request",
    nextAr: "يقوم الموظف بمراجعة طلبك",
  });
  await emitNotification({
    eventType: "case_acknowledged",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `ack:${caseId}`,
  });
  return { ok: true };
}

/** Assign or reassign a case. Passing no assignee triggers workload balancing. */
export async function assignCase(
  caseId: string,
  actorId: string,
  assigneeId?: string | null,
  note?: string,
  reasonCode?: string | null,
  expectedAssignee?: string | null,
) {
  const c = await loadCase(caseId);
  const previousAssignee = (c as { assigned_to?: string | null }).assigned_to ?? null;
  if (isStaleChange(expectedAssignee, previousAssignee)) throw new Error(STALE_MESSAGE.en);
  let target = assigneeId ?? null;
  if (target && target !== actorId && c.service_unit_id) {
    const { unitWorkload } = await import("./assignment.server");
    if (!isEligibleAssignee(target, await unitWorkload(c.service_unit_id))) {
      throw new Error("That staff member is not active and available in this unit.");
    }
  }
  if (!target && c.service_unit_id) {
    target = await pickAssignee(c.service_unit_id, "lowest_workload", {
      id: c.id,
      is_sensitive: false,
      language: c.language,
    });
  }
  if (!target) throw new Error("No eligible assignee found for this unit");

  await checked(supabaseAdmin.from("case_assignments").insert({
    case_id: caseId,
    assigned_to: target,
    assigned_by: actorId,
  }), "staff_operations", "case_assignments", true);
  await transition({
    caseId,
    status: "assigned",
    actorId,
    note: note ?? null,
    extra: { assigned_to: target },
    nextEn: "Assigned officer to acknowledge",
    nextAr: "على الموظف المسند إليه الإقرار",
  });
  await emitNotification({
    eventType: "new_assignment",
    entityType: "case",
    entityId: caseId,
    recipientId: target,
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `assign:${caseId}:${target}`,
  });
  await emitNotification({
    eventType: "case_assigned",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `assign-student:${caseId}:${target}`,
  });
  // Observed, not acted on: a reassignment away from a named officer is a
  // correction Sanadi can learn routing from, after human approval.
  if (previousAssignee && previousAssignee !== target) {
    const { recordLearningSignal } = await import("@/lib/learning/signals.server");
    await recordLearningSignal({
      correctionType: "STAFF_REASSIGNMENT",
      source: "STAFF",
      caseId,
      studentId: c.student_id,
      originalUnitId: c.service_unit_id,
      correctedUnitId: c.service_unit_id,
      originalStaffId: previousAssignee,
      correctedStaffId: target,
      originalDomain: (c as { routing_topic?: string | null }).routing_topic ?? null,
      originalUserText: (c as { title?: string | null }).title ?? null,
      staffComment: note ?? null,
      reasonCode: reasonCode ?? null,
      confidence: 0.6,
    });
    const { noteRuleOutcome } = await import("@/lib/learning/rules.server");
    void noteRuleOutcome({
      caseId,
      success: false,
      reason: reasonCode ?? "Staff reassigned the case",
    });
  }
  return { ok: true, assigneeId: target };
}

/** Generic staff status change with student notification. */
/**
 * Closing the loop: a case never reaches resolved or closed without a recorded
 * outcome, and the student is always told what that outcome is.
 */
export async function changeCaseStatus(
  caseId: string,
  actorId: string,
  status: string,
  note?: string,
  outcome?: string,
) {
  const c = await loadCase(caseId);
  const extra: Record<string, unknown> = {};
  let recordedOutcome: string | null = null;

  if (status === "resolved" || status === "closed") {
    const { data: existing } = await supabaseAdmin
      .from("cases")
      .select("outcome_en")
      .eq("id", caseId)
      .maybeSingle();
    recordedOutcome = (outcome ?? note ?? existing?.outcome_en ?? "").trim() || null;
    if (!recordedOutcome)
      throw new Error("Record the outcome for the student before resolving or closing this request.");
    extra["outcome_en"] = recordedOutcome;
    extra["current_responsible_actor"] = "student";
  }
  if (status === "resolved") extra["resolved_at"] = new Date().toISOString();
  if (status === "closed") {
    extra["closed_at"] = new Date().toISOString();
    extra["sla_state"] = "completed";
  }
  await transition({ caseId, status, actorId, note: note ?? recordedOutcome, extra });
  await emitNotification({
    eventType: "case_status_changed",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number, status, outcome: recordedOutcome ?? "" },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `status:${caseId}:${status}:${Date.now()}`,
  });
  return { ok: true };
}

/** Ask the student for more information; optionally pauses the SLA clock. */
export async function requestInformation(opts: {
  caseId: string;
  actorId: string;
  informationRequired: string;
  reason?: string | undefined;
  dueInDays?: number | undefined;
  pausesSla?: boolean | undefined;
}) {
  const c = await loadCase(opts.caseId);
  const dueAt = new Date(Date.now() + (opts.dueInDays ?? 7) * 86_400_000).toISOString();
  const pauses = opts.pausesSla !== false;

  await checked(supabaseAdmin.from("case_information_requests").insert({
    case_id: opts.caseId,
    requested_by: opts.actorId,
    information_required: opts.informationRequired,
    reason: opts.reason ?? null,
    due_at: dueAt,
    pauses_sla: pauses,
    status: "pending",
  }), "staff_operations", "case_information_requests", true);
  await checked(supabaseAdmin.from("case_comments").insert({
    case_id: opts.caseId,
    author_id: opts.actorId,
    body: opts.informationRequired,
    is_internal: false,
    is_info_request: true,
  }), "staff_operations", "case_comments", false);
  await transition({
    caseId: opts.caseId,
    status: "awaiting_student",
    actorId: opts.actorId,
    note: "Information requested",
    // Ownership is explicit at every moment: the clock and the "who is
    // responsible now" flag move to the student together.
    extra: {
      current_responsible_actor: "student",
      ...(pauses ? { sla_paused_at: new Date().toISOString(), sla_state: "paused" } : {}),
    },
    nextEn: "Waiting for your response",
    nextAr: "بانتظار ردك",
  });
  await emitNotification({
    eventType: "information_requested",
    entityType: "case",
    entityId: opts.caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${opts.caseId}`,
    dedupeKey: `inforeq-new:${opts.caseId}:${dueAt}`,
  });
  return { ok: true, dueAt };
}

/** Student responds to an information request; resumes the SLA clock. */
export async function provideInformation(opts: {
  caseId: string;
  studentId: string;
  responseNote: string;
  requestId?: string | null | undefined;
}) {
  const c = await loadCase(opts.caseId);
  if (c.student_id !== opts.studentId) throw new Error("Forbidden");

  const query = supabaseAdmin
    .from("case_information_requests")
    .update({ status: "responded", responded_at: new Date().toISOString(), response_note: opts.responseNote })
    .eq("case_id", opts.caseId)
    .eq("status", "pending");
  await (opts.requestId ? query.eq("id", opts.requestId) : query);

  await checked(supabaseAdmin.from("case_comments").insert({
    case_id: opts.caseId,
    author_id: opts.studentId,
    body: opts.responseNote,
    is_internal: false,
  }), "staff_operations", "case_comments", false);

  const { data: paused } = await supabaseAdmin
    .from("cases")
    .select("sla_paused_at, sla_paused_minutes")
    .eq("id", opts.caseId)
    .maybeSingle();
  const pausedMinutes = paused?.sla_paused_at
    ? Math.round((Date.now() - new Date(paused.sla_paused_at).getTime()) / 60_000)
    : 0;

  await transition({
    caseId: opts.caseId,
    status: "in_review",
    actorId: opts.studentId,
    note: "Student provided information",
    extra: {
      sla_paused_at: null,
      sla_paused_minutes: (paused?.sla_paused_minutes ?? 0) + pausedMinutes,
      sla_state: "on_track",
      unread_student_message: true,
      current_responsible_actor: "service_owner",
    },
    nextEn: "Officer to review your response",
    nextAr: "على الموظف مراجعة ردك",
  });

  await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
    eventType: "information_provided",
    entityType: "case",
    entityId: opts.caseId,
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${opts.caseId}`,
    dedupeKey: `inforesp:${opts.caseId}:${Date.now()}`,
  });

  // Automation picks the case back up as soon as the student replies.
  try {
    const { resumeAfterStudentInput } = await import("@/lib/automation/case-manager.server");
    await resumeAfterStudentInput(opts.caseId);
  } catch (err) {
    console.error("[ops] automation resume failed", err);
  }
  return { ok: true };
}

/** Officer proposes a resolution for student confirmation. */
export async function proposeResolution(opts: {
  caseId: string;
  actorId: string;
  summaryEn: string;
  summaryAr?: string | undefined;
  resolutionType?: string | undefined;
  actionTaken?: string | undefined;
  policyBasis?: string | undefined;
  remedy?: string | undefined;
  managerApprovalRequired?: boolean | undefined;
}) {
  const c = await loadCase(opts.caseId);
  const { data: resolution } = await supabaseAdmin
    .from("case_resolutions")
    .insert({
      case_id: opts.caseId,
      resolution_type: opts.resolutionType ?? "resolved",
      resolution_summary_en: opts.summaryEn,
      resolution_summary_ar: opts.summaryAr ?? null,
      action_taken: opts.actionTaken ?? null,
      policy_basis: opts.policyBasis ?? null,
      compensation_or_remedy: opts.remedy ?? null,
      prepared_by: opts.actorId,
      manager_approval_required: opts.managerApprovalRequired ?? false,
      proposed_to_student_at: opts.managerApprovalRequired ? null : new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (opts.managerApprovalRequired) {
    await checked(supabaseAdmin.from("approval_requests").insert({
      case_id: opts.caseId,
      approval_type: "resolution",
      requested_by: opts.actorId,
      assigned_approver_role: "service_manager",
      approval_status: "pending",
      request_summary: opts.summaryEn.slice(0, 500),
      due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    }), "staff_operations", "approval_requests", true);
    await transition({
      caseId: opts.caseId,
      status: "in_review",
      actorId: opts.actorId,
      note: "Resolution awaiting manager approval",
      nextEn: "Manager approval pending",
      nextAr: "بانتظار اعتماد المدير",
    });
    return { ok: true, resolutionId: resolution?.id ?? null, awaitingApproval: true };
  }

  await transition({
    caseId: opts.caseId,
    status: "resolution_proposed",
    actorId: opts.actorId,
    note: "Resolution proposed",
    nextEn: "Please review and confirm the proposed resolution",
    nextAr: "يرجى مراجعة الحل المقترح وتأكيده",
  });
  await emitNotification({
    eventType: "resolution_proposed",
    entityType: "case",
    entityId: opts.caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${opts.caseId}`,
    dedupeKey: `resolution:${resolution?.id ?? opts.caseId}`,
  });
  return { ok: true, resolutionId: resolution?.id ?? null, awaitingApproval: false };
}

/** Manager decides on a pending approval request. */
export async function decideApproval(opts: {
  approvalId: string;
  actorId: string;
  approve: boolean;
  reason?: string | undefined;
}) {
  const { data: approval } = await supabaseAdmin
    .from("approval_requests")
    .select("id, case_id, request_summary, requested_by, approval_status")
    .eq("id", opts.approvalId)
    .maybeSingle();
  if (!approval) throw new Error("Approval request not found");
  if (approval.approval_status !== "pending") return { ok: true, alreadyDecided: true };

  await checked(supabaseAdmin
    .from("approval_requests")
    .update({
      approval_status: opts.approve ? "approved" : "rejected",
      decision_reason: opts.reason ?? null,
      decided_at: new Date().toISOString(),
      decided_by: opts.actorId,
    })
    .eq("id", opts.approvalId), "staff_operations", "approval_requests", true);

  if (approval.case_id) {
    const c = await loadCase(approval.case_id);
    if (opts.approve) {
      await checked(supabaseAdmin
        .from("case_resolutions")
        .update({
          approved_by: opts.actorId,
          approved_at: new Date().toISOString(),
          proposed_to_student_at: new Date().toISOString(),
        })
        .eq("case_id", approval.case_id)
        .is("approved_at", null), "staff_operations", "case_resolutions", false);
      await transition({
        caseId: approval.case_id,
        status: "resolution_proposed",
        actorId: opts.actorId,
        note: "Resolution approved by manager",
        nextEn: "Please review and confirm the proposed resolution",
        nextAr: "يرجى مراجعة الحل المقترح وتأكيده",
      });
      await emitNotification({
        eventType: "resolution_proposed",
        entityType: "case",
        entityId: approval.case_id,
        recipientId: c.student_id,
        language: (c.language as "en" | "ar") ?? "en",
        vars: { case_number: c.case_number },
        actionUrl: `/requests/${approval.case_id}`,
        dedupeKey: `resolution-approved:${approval.id}`,
      });
    } else {
      await transition({
        caseId: approval.case_id,
        status: "in_review",
        actorId: opts.actorId,
        note: `Resolution rejected: ${opts.reason ?? "no reason given"}`,
        nextEn: "Officer to revise the proposed resolution",
        nextAr: "على الموظف تعديل الحل المقترح",
      });
    }
  }

  await emitNotification({
    eventType: "approval_completed",
    entityType: "approval",
    entityId: approval.id,
    recipientId: approval.requested_by,
    vars: { status: opts.approve ? "approved" : "rejected", summary: approval.request_summary ?? "" },
    dedupeKey: `approval-done:${approval.id}`,
  });
  return { ok: true, alreadyDecided: false };
}

/** Student accepts or rejects a proposed resolution — the closed-loop step. */
export async function respondToResolution(opts: {
  caseId: string;
  studentId: string;
  accept: boolean;
  comment?: string | undefined;
}) {
  const c = await loadCase(opts.caseId);
  if (c.student_id !== opts.studentId) throw new Error("Forbidden");

  await checked(supabaseAdmin
    .from("case_resolutions")
    .update({
      student_response: opts.accept ? "accepted" : "rejected",
      student_response_at: new Date().toISOString(),
      student_response_comment: opts.comment ?? null,
      ...(opts.accept ? { finalized_at: new Date().toISOString() } : {}),
    })
    .eq("case_id", opts.caseId)
    .is("student_response", null), "staff_operations", "case_resolutions", false);

  if (opts.accept) {
    await transition({
      caseId: opts.caseId,
      status: "resolved",
      actorId: opts.studentId,
      note: "Student accepted the resolution",
      extra: { resolved_at: new Date().toISOString() },
      nextEn: "Share your satisfaction feedback to close the case",
      nextAr: "شاركنا رأيك لإغلاق الحالة",
    });
    await emitNotification({
      eventType: "satisfaction_survey",
      entityType: "case",
      entityId: opts.caseId,
      recipientId: c.student_id,
      language: (c.language as "en" | "ar") ?? "en",
      vars: { case_number: c.case_number },
      actionUrl: `/requests/${opts.caseId}`,
      dedupeKey: `survey:${opts.caseId}`,
    });
  } else {
    await transition({
      caseId: opts.caseId,
      status: "in_review",
      actorId: opts.studentId,
      note: `Student rejected the resolution: ${opts.comment ?? ""}`,
      nextEn: "Officer to review your objection",
      nextAr: "على الموظف مراجعة اعتراضك",
    });
    await escalateCase({
      caseId: opts.caseId,
      reason: "Student rejected the proposed resolution",
      triggerType: "student_rejection",
      triggeredBy: opts.studentId,
    });
  }
  return { ok: true };
}

/** Structured satisfaction feedback; closes the case once submitted. */
export async function submitCaseFeedback(opts: {
  caseId: string;
  studentId: string;
  overall: number;
  speed?: number | undefined;
  quality?: number | undefined;
  communication?: number | undefined;
  fairness?: number | undefined;
  effort?: number | undefined;
  fullyResolved?: boolean | undefined;
  comments?: string | undefined;
}) {
  const c = await loadCase(opts.caseId);
  if (c.student_id !== opts.studentId) throw new Error("Forbidden");

  await checked(supabaseAdmin.from("case_feedback").insert({
    case_id: opts.caseId,
    student_id: opts.studentId,
    overall_satisfaction: opts.overall,
    response_speed_rating: opts.speed ?? null,
    resolution_quality_rating: opts.quality ?? null,
    communication_rating: opts.communication ?? null,
    fairness_rating: opts.fairness ?? null,
    effort_score: opts.effort ?? null,
    issue_fully_resolved: opts.fullyResolved ?? null,
    comments: opts.comments ?? null,
  }), "staff_operations", "case_feedback", true);

  await transition({
    caseId: opts.caseId,
    status: "closed",
    actorId: opts.studentId,
    note: "Closed after satisfaction feedback",
    extra: {
      closed_at: new Date().toISOString(),
      satisfaction_rating: opts.overall,
      sla_state: "completed",
      closure_reason: "resolved_confirmed",
    },
    nextEn: "No further action needed",
    nextAr: "لا يلزم أي إجراء إضافي",
  });
  // A dissatisfied or unresolved outcome is an observation for the learning
  // layer — it changes nothing by itself.
  if (opts.overall <= 2 || opts.fullyResolved === false) {
    const { recordLearningSignal } = await import("@/lib/learning/signals.server");
    await recordLearningSignal({
      correctionType: opts.fullyResolved === false ? "FALSE_RESOLUTION" : "RESPONSE_QUALITY",
      source: "STUDENT",
      caseId: opts.caseId,
      studentId: opts.studentId,
      originalUnitId: c.service_unit_id,
      originalDomain: (c as { routing_topic?: string | null }).routing_topic ?? null,
      originalUserText: (c as { title?: string | null }).title ?? null,
      studentFeedback: opts.comments ?? null,
      outcome: `satisfaction:${opts.overall}`,
      confidence: 0.6,
    });
  }
  return { ok: true };
}

/** Student asks to reopen a closed case. */
export async function requestReopen(opts: {
  caseId: string;
  studentId: string;
  reason: string;
  newEvidence?: string | undefined;
  requestedOutcome?: string | undefined;
}) {
  const c = await loadCase(opts.caseId);
  if (c.student_id !== opts.studentId) throw new Error("Forbidden");
  await checked(supabaseAdmin.from("case_reopen_requests").insert({
    case_id: opts.caseId,
    student_id: opts.studentId,
    reason: opts.reason,
    new_evidence: opts.newEvidence ?? null,
    requested_outcome: opts.requestedOutcome ?? null,
  }), "staff_operations", "case_reopen_requests", true);
  {
    const { recordLearningSignal } = await import("@/lib/learning/signals.server");
    await recordLearningSignal({
      correctionType: "CASE_REOPEN",
      source: "STUDENT",
      caseId: opts.caseId,
      studentId: opts.studentId,
      originalUnitId: c.service_unit_id,
      originalDomain: (c as { routing_topic?: string | null }).routing_topic ?? null,
      originalUserText: (c as { title?: string | null }).title ?? null,
      studentFeedback: opts.reason,
      confidence: 0.65,
    });
  }
  await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
    eventType: "case_reopened",
    entityType: "case",
    entityId: opts.caseId,
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${opts.caseId}`,
    dedupeKey: `reopen-req:${opts.caseId}:${Date.now()}`,
  });
  return { ok: true };
}

/** Manager decides a reopen request. */
export async function decideReopen(opts: {
  reopenId: string;
  actorId: string;
  approve: boolean;
  reason?: string | undefined;
}) {
  const { data: req } = await supabaseAdmin
    .from("case_reopen_requests")
    .select("id, case_id, student_id, review_decision")
    .eq("id", opts.reopenId)
    .maybeSingle();
  if (!req) throw new Error("Reopen request not found");
  if (req.review_decision) return { ok: true, alreadyDecided: true };

  await checked(supabaseAdmin
    .from("case_reopen_requests")
    .update({
      review_decision: opts.approve ? "approved" : "rejected",
      decision_reason: opts.reason ?? null,
      reviewed_by: opts.actorId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", opts.reopenId), "staff_operations", "case_reopen_requests", true);

  const c = await loadCase(req.case_id);
  if (opts.approve) {
    const { data: current } = await supabaseAdmin
      .from("cases")
      .select("reopened_count")
      .eq("id", req.case_id)
      .maybeSingle();
    await transition({
      caseId: req.case_id,
      status: "in_review",
      actorId: opts.actorId,
      note: "Case reopened",
      extra: {
        reopened_count: (current?.reopened_count ?? 0) + 1,
        closed_at: null,
        resolved_at: null,
        sla_state: "on_track",
      },
      nextEn: "Officer to re-examine the case",
      nextAr: "على الموظف إعادة دراسة الحالة",
    });
    await applySlaToCase(req.case_id);
  }

  await emitNotification({
    eventType: opts.approve ? "case_reopened" : "case_status_changed",
    entityType: "case",
    entityId: req.case_id,
    recipientId: req.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number, status: opts.approve ? "reopened" : "closed" },
    actionUrl: `/requests/${req.case_id}`,
    dedupeKey: `reopen-decision:${opts.reopenId}`,
  });
  return { ok: true, alreadyDecided: false };
}

/** Meeting mode as staff record it on the case itself. */
export type MeetingMode = "in_person" | "online" | "phone";

const MEETING_MODE_LABEL: Record<MeetingMode, { en: string; ar: string }> = {
  in_person: { en: "In person", ar: "حضورياً" },
  online: { en: "Online", ar: "عن بُعد" },
  phone: { en: "Phone", ar: "هاتفياً" },
};

/**
 * Staff decide a meeting is needed and record it on the SAME case. No separate
 * appointment record is created — the Appointment Agent remains the only path
 * that books a real slot.
 */
export async function setCaseMeeting(opts: {
  caseId: string;
  actorId: string;
  meetingAt: string;
  mode: MeetingMode;
  location?: string | null | undefined;
  note?: string | null | undefined;
}) {
  const c = await loadCase(opts.caseId);
  const when = new Date(opts.meetingAt);
  if (Number.isNaN(when.getTime())) throw new Error("Enter a valid meeting date and time");

  const label = MEETING_MODE_LABEL[opts.mode];
  const place = (opts.location ?? "").trim() || null;

  await checked(supabaseAdmin
    .from("cases")
    .update({
      meeting_at: when.toISOString(),
      meeting_mode: opts.mode,
      meeting_location: place,
      meeting_note: (opts.note ?? "").trim() || null,
      meeting_set_by: opts.actorId,
      meeting_set_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      next_action_en: "Attend the scheduled meeting",
      next_action_ar: "حضور اللقاء المحدد",
    })
    .eq("id", opts.caseId), "staff_operations", "cases", true);

  const { data: staff } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", opts.actorId)
    .maybeSingle();
  const { data: unit } = c.service_unit_id
    ? await supabaseAdmin
        .from("service_units")
        .select("name_en, name_ar")
        .eq("id", c.service_unit_id)
        .maybeSingle()
    : { data: null };

  const ar = (c.language as string) === "ar";
  const whenText = when.toLocaleString(ar ? "ar-AE" : "en-GB", { timeZone: "Asia/Dubai" });
  const unitName = unit ? (ar ? unit.name_ar : unit.name_en) : "";

  // The student reads it in the case thread, in the case language.
  await checked(supabaseAdmin.from("case_comments").insert({
    case_id: opts.caseId,
    author_id: opts.actorId,
    is_internal: false,
    body: ar
      ? [
          `تم تحديد لقاء لطلبك ${c.case_number}.`,
          `الموعد: ${whenText} (توقيت الإمارات)`,
          `الطريقة: ${label.ar}`,
          place ? `المكان / الرابط: ${place}` : null,
          unitName ? `الجهة: ${unitName}` : null,
          staff?.full_name ? `الموظف المسؤول: ${staff.full_name}` : null,
          (opts.note ?? "").trim() ? `ملاحظة: ${(opts.note ?? "").trim()}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `A meeting has been set for your request ${c.case_number}.`,
          `When: ${whenText} (UAE time)`,
          `Mode: ${label.en}`,
          place ? `Location / link: ${place}` : null,
          unitName ? `Unit: ${unitName}` : null,
          staff?.full_name ? `Responsible staff: ${staff.full_name}` : null,
          (opts.note ?? "").trim() ? `Note: ${(opts.note ?? "").trim()}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
  }), "staff_operations", "case_comments", false);

  await emitNotification({
    eventType: "case_meeting_set",
    entityType: "case",
    entityId: opts.caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: {
      case_number: c.case_number,
      when: whenText,
      mode: ar ? label.ar : label.en,
      location: place ?? "",
      staff_name: staff?.full_name ?? "",
      unit: unitName,
    },
    actionUrl: `/requests/${opts.caseId}`,
    caseId: opts.caseId,
    dedupeKey: `meeting:${opts.caseId}:${when.toISOString()}`,
  });

  await auditInsert(supabaseAdmin, {
    actor_id: opts.actorId,
    action: "case.meeting_set",
    entity_type: "case",
    entity_id: opts.caseId,
    metadata: {
      meeting_at: when.toISOString(),
      mode: opts.mode,
      has_location: Boolean(place),
    } as never,
  });

  return { ok: true, meetingAt: when.toISOString() };
}

/** Staff cancel a recorded meeting; the case itself is untouched otherwise. */
export async function clearCaseMeeting(caseId: string, actorId: string) {
  const c = await loadCase(caseId);
  await checked(supabaseAdmin
    .from("cases")
    .update({
      meeting_at: null,
      meeting_mode: null,
      meeting_location: null,
      meeting_note: null,
      meeting_set_by: actorId,
      meeting_set_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", caseId), "staff_operations", "cases", true);
  await checked(supabaseAdmin.from("case_comments").insert({
    case_id: caseId,
    author_id: actorId,
    is_internal: false,
    body:
      (c.language as string) === "ar"
        ? "تم إلغاء اللقاء المحدد لهذا الطلب. سيتم إبلاغك عند تحديد موعد جديد."
        : "The meeting set for this request has been cancelled. You will be told if a new time is set.",
  }), "staff_operations", "case_comments", false);
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "case.meeting_cleared",
    entity_type: "case",
    entity_id: caseId,
    metadata: {} as never,
  });
  await emitNotification({
    eventType: "case_meeting_cancelled",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    caseId,
    dedupeKey: `meeting-cancelled:${caseId}:${new Date().toISOString().slice(0, 16)}`,
  });
  return { ok: true };
}
