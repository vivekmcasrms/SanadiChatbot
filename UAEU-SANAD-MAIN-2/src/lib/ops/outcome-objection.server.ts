/**
 * Outcome & objection: everything a student can do about the result of their
 * own case, inside the same case.
 *
 * A question, a correction request, an objection or a reopen request never
 * starts a new unrelated case — each is recorded against the original case,
 * the original outcome is snapshotted before anything changes, and the case
 * moves to a review state that a person owns.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification, notifyUnitStaff } from "./notify.server";
import { escalateCase } from "./routing.server";

export type ConcernKind = "question" | "correction" | "objection" | "reopen";

export type CaseOutcomeView = {
  status: string;
  outcomeEn: string | null;
  outcomeAr: string | null;
  explanationEn: string | null;
  explanationAr: string | null;
  unitEn: string | null;
  unitAr: string | null;
  staffName: string | null;
  resolvedAt: string | null;
  nextStepEn: string | null;
  nextStepAr: string | null;
  concerns: {
    id: string;
    kind: ConcernKind;
    reason: string;
    createdAt: string;
    decision: string | null;
    decisionReason: string | null;
    reviewedAt: string | null;
    originalOutcomeEn: string | null;
    originalOutcomeAr: string | null;
  }[];
};

async function loadOwnedCase(caseId: string, studentId: string) {
  const { data } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, student_id, language, status, service_unit_id, assigned_to, outcome_en, outcome_ar, next_action_en, next_action_ar, resolved_at, closed_at",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!data) throw new Error("Case not found");
  if (data.student_id !== studentId) throw new Error("Forbidden");
  return data;
}

export async function getCaseOutcome(caseId: string, studentId: string): Promise<CaseOutcomeView> {
  const c = await loadOwnedCase(caseId, studentId);

  const [{ data: unit }, { data: staff }, { data: resolution }, { data: concerns }] = await Promise.all([
    c.service_unit_id
      ? supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", c.service_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.assigned_to
      ? supabaseAdmin.from("profiles").select("full_name").eq("id", c.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("case_resolutions")
      .select("resolution_summary_en, resolution_summary_ar, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("case_reopen_requests")
      .select(
        "id, kind, reason, created_at, review_decision, decision_reason, reviewed_at, original_outcome_en, original_outcome_ar",
      )
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    status: c.status,
    outcomeEn: c.outcome_en,
    outcomeAr: c.outcome_ar,
    explanationEn: resolution?.resolution_summary_en ?? null,
    explanationAr: resolution?.resolution_summary_ar ?? null,
    unitEn: unit?.name_en ?? null,
    unitAr: unit?.name_ar ?? unit?.name_en ?? null,
    staffName: staff?.full_name ?? null,
    resolvedAt: c.resolved_at ?? c.closed_at,
    nextStepEn: c.next_action_en,
    nextStepAr: c.next_action_ar,
    concerns: (concerns ?? []).map((r) => ({
      id: r.id,
      kind: (r.kind as ConcernKind) ?? "reopen",
      reason: r.reason,
      createdAt: r.created_at,
      decision: r.review_decision || null,
      decisionReason: r.decision_reason,
      reviewedAt: r.reviewed_at,
      originalOutcomeEn: r.original_outcome_en,
      originalOutcomeAr: r.original_outcome_ar,
    })),
  };
}

const NEXT_STEP: Record<Exclude<ConcernKind, "question">, { en: string; ar: string }> = {
  correction: {
    en: "Your correction request is with the responsible unit for review.",
    ar: "طلب التصحيح لديك قيد المراجعة من الوحدة المسؤولة.",
  },
  objection: {
    en: "Your objection is under review by the authorised reviewer.",
    ar: "اعتراضك قيد المراجعة من الجهة المخوّلة.",
  },
  reopen: {
    en: "Your request to reopen is with the responsible unit.",
    ar: "طلب إعادة الفتح لديك لدى الوحدة المسؤولة.",
  },
};

/**
 * Records a student's question, correction request, objection or reopen
 * request on their own case. The original outcome is never overwritten.
 */
export async function raiseOutcomeConcern(opts: {
  caseId: string;
  studentId: string;
  kind: ConcernKind;
  reason: string;
  lang: "en" | "ar";
}) {
  const c = await loadOwnedCase(opts.caseId, opts.studentId);
  const now = new Date().toISOString();

  // Everything the student writes stays visible in the case conversation.
  await supabaseAdmin.from("case_comments").insert({
    case_id: opts.caseId,
    author_id: opts.studentId,
    body: opts.reason,
    is_internal: false,
  });

  if (opts.kind === "question") {
    await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
      eventType: "case_status_changed",
      entityType: "case",
      entityId: opts.caseId,
      vars: { case_number: c.case_number, status: "question about the outcome" },
      actionUrl: `/requests/${opts.caseId}`,
      dedupeKey: `outcome-question:${opts.caseId}:${now}`,
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: opts.studentId,
      action: "case.outcome_question",
      entity_type: "case",
      entity_id: opts.caseId,
      metadata: { kind: "question" } as never,
    });
    return { ok: true, status: c.status };
  }

  // The outcome as the student saw it is preserved before any review starts.
  await supabaseAdmin.from("case_reopen_requests").insert({
    case_id: opts.caseId,
    student_id: opts.studentId,
    kind: opts.kind,
    reason: opts.reason,
    original_status: c.status,
    original_outcome_en: c.outcome_en,
    original_outcome_ar: c.outcome_ar,
    original_decided_at: c.resolved_at ?? c.closed_at,
  });

  const next = NEXT_STEP[opts.kind];
  await supabaseAdmin
    .from("cases")
    .update({
      status: "in_review" as never,
      last_activity_at: now,
      next_action_en: next.en,
      next_action_ar: next.ar,
    })
    .eq("id", opts.caseId);

  await supabaseAdmin.from("case_status_history").insert({
    case_id: opts.caseId,
    from_status: c.status as never,
    to_status: "in_review" as never,
    changed_by: opts.studentId,
    note:
      opts.kind === "objection"
        ? "Student objected to the outcome"
        : opts.kind === "correction"
          ? "Student requested a correction to the outcome"
          : "Student requested to reopen the case",
  });

  // An objection goes to the authorised reviewer, not back to the same desk.
  if (opts.kind === "objection") {
    await escalateCase({
      caseId: opts.caseId,
      reason: `Student objection: ${opts.reason}`,
      triggerType: "manual",
      triggeredBy: opts.studentId,
    }).catch(() => false);
  }

  await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
    eventType: opts.kind === "reopen" ? "case_reopened" : "case_status_changed",
    entityType: "case",
    entityId: opts.caseId,
    vars: { case_number: c.case_number, status: opts.kind },
    actionUrl: `/requests/${opts.caseId}`,
    dedupeKey: `outcome-${opts.kind}:${opts.caseId}:${now}`,
  });

  // The student is told, in their own language, what happens next.
  await emitNotification({
    eventType: "case_status_changed",
    entityType: "case",
    entityId: opts.caseId,
    recipientId: opts.studentId,
    caseId: opts.caseId,
    language: opts.lang,
    vars: { case_number: c.case_number, status: opts.lang === "ar" ? "قيد المراجعة" : "under review" },
    actionUrl: `/requests/${opts.caseId}`,
  });

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: opts.studentId,
    action: `case.outcome_${opts.kind}`,
    entity_type: "case",
    entity_id: opts.caseId,
    metadata: { kind: opts.kind, original_status: c.status, original_outcome: c.outcome_en } as never,
  });

  return { ok: true, status: "in_review" };
}
