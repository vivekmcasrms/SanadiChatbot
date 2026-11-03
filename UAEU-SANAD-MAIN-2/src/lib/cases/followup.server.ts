/**
 * Natural-language case continuity. Server only.
 *
 * One student journey, one case: adding information, amending details, asking
 * about a result, requesting a correction and raising an objection all attach
 * to the SAME case the student already has. Nothing here creates a duplicate
 * case, and an objection never overwrites the original decision — the decision
 * is copied into the review record before the case moves to review.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Lang } from "../agent-types";
import type { Db } from "../agent/tools.server";
import { COMPLETED_STATUSES, OPEN_STATUSES } from "../lists/case-status";
import { emitNotification, notifyUnitStaff } from "../ops/notify.server";
import { statusLabel } from "./status-labels";

export { statusLabel };

export type ReviewKind = "question" | "correction" | "objection";

export type CaseResultCard = {
  caseId: string;
  reference: string;
  title: string;
  /** Plain-language status, never a raw database value. */
  statusLabel: string;
  outcome: string | null;
  decidedAt: string | null;
  unitName: string | null;
  staffName: string | null;
  staffEmail: string | null;
  explanation: string | null;
  nextSteps: string[];
  /** Whether the follow-up actions apply to this case. */
  canObject: boolean;
  reviewState: {
    kind: ReviewKind;
    submittedAt: string;
    decision: string | null;
  } | null;
  trackingUrl: string;
};

type CaseRow = {
  id: string;
  case_number: string;
  student_id: string;
  title: string;
  description: string | null;
  desired_resolution: string | null;
  status: string;
  case_type: string;
  language: string | null;
  service_unit_id: string | null;
  assigned_to: string | null;
  outcome_en: string | null;
  outcome_ar: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  next_action_en: string | null;
  next_action_ar: string | null;
  closure_reason: string | null;
};

const CASE_FIELDS =
  "id, case_number, student_id, title, description, desired_resolution, status, case_type, language, service_unit_id, assigned_to, outcome_en, outcome_ar, resolved_at, closed_at, created_at, next_action_en, next_action_ar, closure_reason";

/**
 * Finds the case the student is talking about. A reference number wins; then
 * the most recently decided case (for "I disagree with this result"); then the
 * most recent open case (for "I want to add something").
 */
export async function resolveStudentCase(
  db: Db,
  userId: string,
  opts: { reference?: string | null; prefer?: "decided" | "open" | "any" } = {},
): Promise<CaseRow | null> {
  const ref = (opts.reference ?? "").trim();
  if (ref) {
    const { data } = await db
      .from("cases")
      .select(CASE_FIELDS)
      .eq("student_id", userId)
      .ilike("case_number", ref)
      .maybeSingle();
    if (data) return data as unknown as CaseRow;
  }
  const prefer = opts.prefer ?? "any";
  const order = prefer === "decided" ? [COMPLETED_STATUSES, OPEN_STATUSES] : prefer === "open" ? [OPEN_STATUSES, COMPLETED_STATUSES] : [[...OPEN_STATUSES, ...COMPLETED_STATUSES]];
  for (const statuses of order) {
    const { data } = await db
      .from("cases")
      .select(CASE_FIELDS)
      .eq("student_id", userId)
      .in("status", statuses as never[])
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (data && data.length) return data[0] as unknown as CaseRow;
  }
  return null;
}

async function unitAndStaff(db: Db, kase: CaseRow, lang: Lang) {
  // Staff contact details are read with the service client: a student may not
  // read another person's profile row, but must still be told who is handling
  // their case.
  const [unit, staff] = await Promise.all([
    kase.service_unit_id
      ? db.from("service_units").select("name_en, name_ar").eq("id", kase.service_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    kase.assigned_to
      ? supabaseAdmin.from("profiles").select("full_name, email").eq("id", kase.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const u = unit.data as { name_en: string; name_ar: string } | null;
  const s = staff.data as { full_name: string | null; email: string | null } | null;
  return {
    unitName: u ? (lang === "ar" ? u.name_ar : u.name_en) : null,
    staffName: s?.full_name ?? null,
    staffEmail: s?.email ?? null,
  };
}

/** The result card the student sees when a request has been decided. */
export async function buildCaseResultCard(
  db: Db,
  kase: CaseRow,
  lang: Lang,
): Promise<CaseResultCard> {
  const { unitName, staffName, staffEmail } = await unitAndStaff(db, kase, lang);
  const decided = COMPLETED_STATUSES.includes(kase.status);
  const outcome = (lang === "ar" ? kase.outcome_ar : kase.outcome_en) ?? kase.outcome_en ?? kase.outcome_ar;
  const nextStep = lang === "ar" ? kase.next_action_ar : kase.next_action_en;

  const { data: review } = await db
    .from("case_reopen_requests")
    .select("kind, created_at, review_decision")
    .eq("case_id", kase.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = review?.[0] as
    | { kind: string | null; created_at: string; review_decision: string | null }
    | undefined;

  const nextSteps: string[] = [];
  if (nextStep) nextSteps.push(nextStep);
  if (decided && !latest) {
    nextSteps.push(
      lang === "ar"
        ? "إذا لم تكن النتيجة واضحة أو غير موافق عليها، اكتب لي هنا وسأتابعها على نفس الطلب."
        : "If the result is unclear or you disagree, tell me here and I will follow it up on this same request.",
    );
  }

  return {
    caseId: kase.id,
    reference: kase.case_number,
    title: kase.title,
    statusLabel: statusLabel(kase.status, lang),
    outcome: outcome ?? null,
    decidedAt: kase.closed_at ?? kase.resolved_at ?? null,
    unitName,
    staffName,
    staffEmail,
    explanation: kase.closure_reason ?? null,
    nextSteps,
    canObject: decided,
    reviewState: latest
      ? {
          kind: (latest.kind as ReviewKind) ?? "objection",
          submittedAt: latest.created_at,
          decision: latest.review_decision,
        }
      : null,
    trackingUrl: `/requests/${kase.id}`,
  };
}

/** Student adds information to an existing case, in their own words. */
export async function appendCaseUpdate(opts: {
  db: Db;
  kase: CaseRow;
  studentId: string;
  body: string;
  lang: Lang;
}) {
  const { error } = await supabaseAdmin.from("case_comments").insert({
    case_id: opts.kase.id,
    author_id: opts.studentId,
    body: opts.body,
    is_internal: false,
  });
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("cases")
    .update({ last_activity_at: new Date().toISOString(), unread_student_message: true })
    .eq("id", opts.kase.id);

  await notifyUnitStaff(opts.kase.service_unit_id, opts.kase.assigned_to, {
    eventType: "student_response_received",
    entityType: "case",
    entityId: opts.kase.id,
    caseId: opts.kase.id,
    vars: { case_number: opts.kase.case_number },
    actionUrl: `/requests/${opts.kase.id}`,
    dedupeKey: `student-update:${opts.kase.id}:${Date.now()}`,
  });
  return { reference: opts.kase.case_number, caseId: opts.kase.id };
}

/** Student modifies what they submitted. The previous text is kept in the thread. */
export async function amendCaseDetails(opts: {
  db: Db;
  kase: CaseRow;
  studentId: string;
  description?: string | null;
  desiredResolution?: string | null;
  lang: Lang;
}) {
  if (COMPLETED_STATUSES.includes(opts.kase.status)) {
    throw new Error("decided");
  }
  const updates: Record<string, string> = {};
  if (opts.description) updates["description"] = opts.description.slice(0, 4000);
  if (opts.desiredResolution) updates["desired_resolution"] = opts.desiredResolution.slice(0, 2000);
  if (!Object.keys(updates).length) throw new Error("nothing_to_change");

  // Audit the superseded version in the case thread before overwriting it.
  await supabaseAdmin.from("case_comments").insert({
    case_id: opts.kase.id,
    author_id: opts.studentId,
    body:
      `Student amended the request.\nPrevious description: ${opts.kase.description ?? "—"}\n` +
      `Previous desired outcome: ${opts.kase.desired_resolution ?? "—"}`,
    is_internal: true,
  });

  const { error } = await supabaseAdmin
    .from("cases")
    .update({ ...updates, last_activity_at: new Date().toISOString(), unread_student_message: true })
    .eq("id", opts.kase.id)
    .eq("student_id", opts.studentId);
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("case_status_history").insert({
    case_id: opts.kase.id,
    from_status: opts.kase.status as never,
    to_status: opts.kase.status as never,
    note: "Student amended the request details through Sanadi chat.",
    changed_by: opts.studentId,
  });

  await notifyUnitStaff(opts.kase.service_unit_id, opts.kase.assigned_to, {
    eventType: "student_response_received",
    entityType: "case",
    entityId: opts.kase.id,
    caseId: opts.kase.id,
    vars: { case_number: opts.kase.case_number },
    actionUrl: `/requests/${opts.kase.id}`,
    dedupeKey: `student-amend:${opts.kase.id}:${Date.now()}`,
  });
  return { reference: opts.kase.case_number, caseId: opts.kase.id };
}

const REVIEW_TITLE: Record<ReviewKind, { en: string; ar: string }> = {
  question: { en: "Question about the result", ar: "استفسار عن النتيجة" },
  correction: { en: "Correction requested", ar: "طلب تصحيح" },
  objection: { en: "Objection raised", ar: "اعتراض" },
};

/**
 * Question / correction / objection on a decided case. The original decision is
 * copied into the review record first, then the case moves to a review state
 * and is routed back to the responsible unit. No new case is created.
 */
export async function openCaseReview(opts: {
  db: Db;
  kase: CaseRow;
  studentId: string;
  kind: ReviewKind;
  reason: string;
  requestedOutcome?: string | null;
  lang: Lang;
}) {
  const kase = opts.kase;
  const decided = COMPLETED_STATUSES.includes(kase.status);

  const { data: existing } = await opts.db
    .from("case_reopen_requests")
    .select("id, kind, created_at, review_decision")
    .eq("case_id", kase.id)
    .is("review_decision", null)
    .limit(1);
  if (existing && existing.length) {
    return {
      duplicate: true as const,
      caseId: kase.id,
      reference: kase.case_number,
      kind: (existing[0] as { kind: string | null }).kind ?? "objection",
    };
  }

  const { error } = await supabaseAdmin.from("case_reopen_requests").insert({
    case_id: kase.id,
    student_id: opts.studentId,
    kind: opts.kind,
    reason: opts.reason.slice(0, 4000),
    requested_outcome: opts.requestedOutcome?.slice(0, 2000) ?? null,
    original_status: kase.status,
    original_outcome_en: kase.outcome_en,
    original_outcome_ar: kase.outcome_ar,
    original_decided_at: kase.closed_at ?? kase.resolved_at,
  });
  if (error) throw new Error(error.message);

  // A question is answered in the thread and does not disturb the decision.
  // A correction or an objection puts the case back under review.
  if (opts.kind !== "question" && decided) {
    await supabaseAdmin
      .from("cases")
      .update({
        status: "in_review" as never,
        last_activity_at: new Date().toISOString(),
        unread_student_message: true,
      })
      .eq("id", kase.id);
    await supabaseAdmin.from("case_status_history").insert({
      case_id: kase.id,
      from_status: kase.status as never,
      to_status: "in_review" as never,
      note: `${REVIEW_TITLE[opts.kind].en}: ${opts.reason.slice(0, 500)}`,
      changed_by: opts.studentId,
    });
  }

  await supabaseAdmin.from("case_comments").insert({
    case_id: kase.id,
    author_id: opts.studentId,
    body: `${REVIEW_TITLE[opts.kind].en}\n${opts.reason}`,
    is_internal: false,
  });

  await notifyUnitStaff(kase.service_unit_id, kase.assigned_to, {
    eventType: opts.kind === "question" ? "student_response_received" : "case_reopened",
    entityType: "case",
    entityId: kase.id,
    caseId: kase.id,
    vars: { case_number: kase.case_number },
    actionUrl: `/requests/${kase.id}`,
    dedupeKey: `review:${opts.kind}:${kase.id}:${Date.now()}`,
  });

  await emitNotification({
    recipientId: opts.studentId,
    eventType: "case_status_changed",
    entityType: "case",
    entityId: kase.id,
    caseId: kase.id,
    language: opts.lang,
    vars: {
      case_number: kase.case_number,
      status: opts.kind === "question" ? statusLabel(kase.status, opts.lang) : statusLabel("in_review", opts.lang),
    },
    actionUrl: `/requests/${kase.id}`,
    dedupeKey: `review-ack:${opts.kind}:${kase.id}:${Date.now()}`,
  });

  return { duplicate: false as const, caseId: kase.id, reference: kase.case_number, kind: opts.kind };
}

export type { CaseRow };
