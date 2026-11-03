import { auditInsert } from "@/lib/exceptions/handle.server";
/** Closed-loop suggestion lifecycle: intake → triage → assessment → decision → outcome. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification, notifyUnitStaff } from "./notify.server";
import { pickAssignee } from "./routing.server";

export type SuggestionStatus =
  | "submitted"
  | "under_review"
  | "assigned"
  | "planned"
  | "implemented"
  | "closed"
  | "not_proceeding";

type SuggestionCore = {
  id: string;
  reference_number: string;
  student_id: string;
  title: string;
  language: string;
  status: string;
  service_unit_id: string | null;
  assigned_staff_id: string | null;
  review_due_at: string | null;
  is_anonymous: boolean;
};

const REVIEW_DUE_DAYS = 14;

export async function loadSuggestion(id: string): Promise<SuggestionCore> {
  const { data } = await supabaseAdmin
    .from("suggestions")
    .select(
      "id, reference_number, student_id, title, language, status, service_unit_id, assigned_staff_id, review_due_at, is_anonymous",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("Suggestion not found");
  return data as SuggestionCore;
}

async function addUpdate(opts: {
  suggestionId: string;
  actorId: string | null;
  type: string;
  en: string;
  ar: string;
  visible?: boolean;
}) {
  await supabaseAdmin.from("suggestion_updates").insert({
    suggestion_id: opts.suggestionId,
    update_type: opts.type,
    update_text_en: opts.en,
    update_text_ar: opts.ar,
    visible_to_student: opts.visible ?? true,
    created_by: opts.actorId,
  });
}

async function audit(actorId: string | null, action: string, id: string, metadata: Record<string, unknown>) {
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action,
    entity_type: "suggestion",
    entity_id: id,
    metadata: metadata as never,
  });
}

async function notifyStudent(s: SuggestionCore, status: string, extraEn?: string) {
  await emitNotification({
    eventType: "suggestion_status_changed",
    entityType: "suggestion",
    entityId: s.id,
    recipientId: s.student_id,
    language: (s.language as "en" | "ar") ?? "en",
    vars: { reference: s.reference_number, status, note: extraEn ?? "" },
    actionUrl: "/requests",
    dedupeKey: `sugg-status:${s.id}:${status}:${Date.now()}`,
  });
}

/**
 * Intake automation: route the suggestion to a reviewing officer in the owning
 * unit, set the review deadline and notify the unit. Safe to call twice.
 */
export async function intakeSuggestion(suggestionId: string): Promise<{
  unitId: string | null;
  assigneeId: string | null;
}> {
  const s = await loadSuggestion(suggestionId);
  if (s.assigned_staff_id) return { unitId: s.service_unit_id, assigneeId: s.assigned_staff_id };

  let assignee: string | null = null;
  if (s.service_unit_id) {
    assignee = await pickAssignee(s.service_unit_id, "lowest_workload", {
      id: s.id,
      is_sensitive: false,
      language: s.language,
    });
  }

  const reviewDue = s.review_due_at ?? new Date(Date.now() + REVIEW_DUE_DAYS * 86_400_000).toISOString();
  await supabaseAdmin
    .from("suggestions")
    .update({
      assigned_staff_id: assignee,
      review_due_at: reviewDue,
      status: (assignee ? "assigned" : "submitted") as never,
    })
    .eq("id", suggestionId);

  await addUpdate({
    suggestionId,
    actorId: null,
    type: "routed",
    en: assignee
      ? "Your suggestion was routed to the responsible unit and a reviewing officer was assigned."
      : "Your suggestion was received and is queued for review by the responsible unit.",
    ar: assignee
      ? "تم توجيه اقتراحك إلى الوحدة المسؤولة وتعيين موظف للمراجعة."
      : "تم استلام اقتراحك وهو في قائمة المراجعة لدى الوحدة المسؤولة.",
  });

  await notifyUnitStaff(s.service_unit_id, assignee, {
    eventType: "suggestion_status_changed",
    entityType: "suggestion",
    entityId: s.id,
    vars: { reference: s.reference_number, status: "submitted", title: s.title },
    actionUrl: "/cases?tab=suggestions",
    dedupeKey: `sugg-intake:${s.id}`,
  });
  await audit(null, "suggestion.routed", s.id, { unit: s.service_unit_id, assignee });

  return { unitId: s.service_unit_id, assigneeId: assignee };
}

/** Officer acknowledges the suggestion and starts the review. */
export async function acknowledgeSuggestion(id: string, actorId: string, note?: string) {
  const s = await loadSuggestion(id);
  await supabaseAdmin
    .from("suggestions")
    .update({ status: "under_review" as never, assigned_staff_id: s.assigned_staff_id ?? actorId })
    .eq("id", id);
  await addUpdate({
    suggestionId: id,
    actorId,
    type: "acknowledged",
    en: note?.trim() || "Your suggestion is now under review by the responsible unit.",
    ar: note?.trim() || "اقتراحك قيد المراجعة من قبل الوحدة المسؤولة.",
  });
  await notifyStudent(s, "under_review");
  await audit(actorId, "suggestion.acknowledged", id, {});
  return { ok: true };
}

/** Claim or reassign the review owner. */
export async function assignSuggestion(id: string, actorId: string, assigneeId?: string | null) {
  const s = await loadSuggestion(id);
  let target = assigneeId ?? actorId;
  if (!assigneeId && !target && s.service_unit_id) {
    target = (await pickAssignee(s.service_unit_id, "lowest_workload", {
      id: s.id,
      is_sensitive: false,
      language: s.language,
    })) as string;
  }
  if (!target) throw new Error("No eligible reviewer found");
  await supabaseAdmin
    .from("suggestions")
    .update({ assigned_staff_id: target, status: (s.status === "submitted" ? "assigned" : s.status) as never })
    .eq("id", id);
  await emitNotification({
    eventType: "new_assignment",
    entityType: "suggestion",
    entityId: id,
    recipientId: target,
    vars: { case_number: s.reference_number, reference: s.reference_number },
    actionUrl: "/cases?tab=suggestions",
    dedupeKey: `sugg-assign:${id}:${target}`,
  });
  await audit(actorId, "suggestion.assigned", id, { assignee: target });
  return { ok: true, assigneeId: target };
}

/** Record the structured assessment used to justify the decision. */
export async function assessSuggestion(opts: {
  suggestionId: string;
  actorId: string;
  impact: number;
  feasibility: number;
  alignment: number;
  costBand?: string | null | undefined;
  complexity?: string | null | undefined;
  recommendation: string;
  rationale?: string | null | undefined;
}) {
  const s = await loadSuggestion(opts.suggestionId);
  await supabaseAdmin.from("suggestion_assessments").insert({
    suggestion_id: opts.suggestionId,
    reviewer_id: opts.actorId,
    student_impact_score: opts.impact,
    feasibility_score: opts.feasibility,
    strategic_alignment_score: opts.alignment,
    estimated_cost_band: opts.costBand ?? null,
    implementation_complexity: opts.complexity ?? null,
    recommendation: opts.recommendation,
    rationale: opts.rationale ?? null,
  });
  if (s.status === "submitted" || s.status === "assigned") {
    await supabaseAdmin.from("suggestions").update({ status: "under_review" as never }).eq("id", opts.suggestionId);
  }
  await addUpdate({
    suggestionId: opts.suggestionId,
    actorId: opts.actorId,
    type: "assessed",
    en: "The unit completed its assessment of your suggestion.",
    ar: "أكملت الوحدة تقييم اقتراحك.",
  });
  await audit(opts.actorId, "suggestion.assessed", opts.suggestionId, { recommendation: opts.recommendation });
  return { ok: true };
}

/** Final decision: plan it, implement it, close it or decline it — always explained to the student. */
export async function decideSuggestion(opts: {
  suggestionId: string;
  actorId: string;
  decision: "planned" | "implemented" | "not_proceeding" | "closed";
  outcomeEn: string;
  outcomeAr?: string | null | undefined;
  targetDate?: string | null | undefined;
}) {
  const s = await loadSuggestion(opts.suggestionId);
  await supabaseAdmin
    .from("suggestions")
    .update({
      status: opts.decision as never,
      outcome_summary: opts.outcomeEn,
      implementation_target_date: opts.targetDate ?? null,
    })
    .eq("id", opts.suggestionId);

  await supabaseAdmin.from("suggestion_reviews").insert({
    suggestion_id: opts.suggestionId,
    reviewer_id: opts.actorId,
    decision: opts.decision,
    notes: opts.outcomeEn,
  });

  await addUpdate({
    suggestionId: opts.suggestionId,
    actorId: opts.actorId,
    type: opts.decision,
    en: opts.outcomeEn,
    ar: opts.outcomeAr?.trim() || opts.outcomeEn,
  });
  await notifyStudent(s, opts.decision, opts.outcomeEn);
  await audit(opts.actorId, "suggestion.decided", opts.suggestionId, { decision: opts.decision });
  return { ok: true };
}

/** Progress note during implementation. */
export async function postSuggestionUpdate(opts: {
  suggestionId: string;
  actorId: string;
  textEn: string;
  textAr?: string | null | undefined;
  visibleToStudent: boolean;
}) {
  const s = await loadSuggestion(opts.suggestionId);
  await addUpdate({
    suggestionId: opts.suggestionId,
    actorId: opts.actorId,
    type: "progress",
    en: opts.textEn,
    ar: opts.textAr?.trim() || opts.textEn,
    visible: opts.visibleToStudent,
  });
  if (opts.visibleToStudent) await notifyStudent(s, s.status, opts.textEn);
  await audit(opts.actorId, "suggestion.update", opts.suggestionId, { visible: opts.visibleToStudent });
  return { ok: true };
}

/** Scheduled sweep: nudge reviewers whose suggestion review deadline has passed. */
export async function suggestionReviewReminders(): Promise<{ processed: number; details: Record<string, number> }> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("suggestions")
    .select("id, reference_number, service_unit_id, assigned_staff_id, review_due_at, status")
    .in("status", ["submitted", "assigned", "under_review"])
    .lt("review_due_at", nowIso)
    .limit(300);

  let reminded = 0;
  let routed = 0;
  for (const s of rows ?? []) {
    if (!s.assigned_staff_id) {
      await intakeSuggestion(s.id);
      routed += 1;
    }
    await notifyUnitStaff(s.service_unit_id, s.assigned_staff_id, {
      eventType: "sla_overdue",
      entityType: "suggestion",
      entityId: s.id,
      vars: { case_number: s.reference_number, reference: s.reference_number },
      actionUrl: "/cases?tab=suggestions",
      dedupeKey: `sugg-overdue:${s.id}:${(s.review_due_at ?? "").slice(0, 10)}`,
    });
    reminded += 1;
  }
  return { processed: reminded, details: { reminded, routed } };
}
