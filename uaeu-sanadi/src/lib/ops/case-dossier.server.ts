import { checked } from "@/lib/exceptions/handle.server";
import { auditInsert } from "@/lib/exceptions/handle.server";
/** Unified case dossier: complaint, conversation, internship outcome, notes and timeline. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification } from "./notify.server";
import { assertStaff, loadCase } from "./case-actions.server";

export const OWNER_CASE_STATUSES = [
  "submitted",
  "ai_processing",
  "in_progress",
  "awaiting_student",
  "waiting_external",
  "placement_allocated",
  "resolved",
  "closed",
  "reopened",
  "escalated",
] as const;
export type OwnerCaseStatus = (typeof OWNER_CASE_STATUSES)[number];

export const CONVERSATION_STATUSES = ["active", "waiting_student", "waiting_staff", "resolved", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export type ActorKind = "student" | "ai" | "owner" | "system";

export type TimelineEvent = {
  id: string;
  at: string;
  actor: ActorKind;
  actorName: string | null;
  kind: string;
  title: string;
  detail: string | null;
  internal: boolean;
};

/** Staff guard: must be staff AND allowed to see this specific case. */
export async function assertCaseAccess(userId: string, caseId: string) {
  await assertStaff(userId);
  const { data, error } = await supabaseAdmin.rpc("can_access_case", { _case_id: caseId, _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: this case belongs to another service unit");
  return true;
}

async function nameOf(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return {};
  const { data } = await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", unique);
  const map: Record<string, string> = {};
  for (const p of data ?? []) map[p.id] = p.full_name ?? p.email ?? p.id;
  return map;
}

async function staffIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", [...new Set(ids)]);
  const set = new Set<string>();
  for (const r of data ?? []) if (String(r.role) !== "student") set.add(r.user_id);
  return set;
}

/** Everything the service owner needs on one screen. */
export async function caseDossier(caseId: string, userId: string) {
  await assertCaseAccess(userId, caseId);

  const { data: kase } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, title, description, status, urgency, case_type, language, created_at, resolved_at, closed_at, outcome_en, outcome_ar, ai_summary, ai_confidence, ai_recommended_action, assigned_to, service_unit_id, student_id, related_conversation_id, related_internship_assignment_id, sla_state, escalation_level, reopened_count, next_action_en, next_action_ar, case_categories(name_en, name_ar), service_units(name_en, name_ar, code)",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!kase) throw new Error("Case not found");

  const [{ data: profile }, { data: studentProfile }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, email, phone").eq("id", kase.student_id).maybeSingle(),
    supabaseAdmin
      .from("student_profiles")
      .select("student_number, completed_credit_hours, cumulative_gpa, academic_programs(name_en, name_ar)")
      .eq("user_id", kase.student_id)
      .maybeSingle(),
  ]);

  const assignmentId =
    kase.related_internship_assignment_id ??
    (
      await supabaseAdmin
        .from("internship_assignments")
        .select("id")
        .eq("related_case_id", caseId)
        .maybeSingle()
    ).data?.id ??
    null;

  const assignment = assignmentId
    ? (
        await supabaseAdmin
          .from("internship_assignments")
          .select(
            "id, assignment_number, assignment_status, match_score, assigned_at, assigned_by_type, course_registration_status, employer_acceptance_status, owner_review_status, requires_human_review, human_review_reason, owner_notes, internship_start_date, internship_end_date, opportunity_id, internship_opportunities(opportunity_code, title_en, title_ar, location_emirate, location_city, work_mode), internship_organizations(name_en, name_ar, sector), internship_match_explanations(explanation_en, explanation_ar, total_match_score)",
          )
          .eq("id", assignmentId)
          .maybeSingle()
      ).data
    : null;

  const conversationId = kase.related_conversation_id;
  const [history, comments, messages, audit, notifications, conversation, alternatives] = await Promise.all([
    supabaseAdmin
      .from("case_status_history")
      .select("id, from_status, to_status, note, changed_by, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("case_comments")
      .select("id, body, author_id, is_internal, is_info_request, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    conversationId
      ? supabaseAdmin
          .from("messages")
          .select("id, role, content, created_at, metadata")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    assignmentId
      ? supabaseAdmin
          .from("internship_assignment_audit")
          .select("id, event_type, actor_type, actor_id, details, created_at")
          .eq("assignment_id", assignmentId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    supabaseAdmin
      .from("notification_events")
      .select("id, event_type, title, body, channel, status, created_at")
      .eq("entity_id", caseId)
      .order("created_at", { ascending: true }),
    conversationId
      ? supabaseAdmin
          .from("conversations")
          .select("id, title, conversation_status, updated_at")
          .eq("id", conversationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("internship_opportunities")
      .select("id, opportunity_code, title_en, title_ar, available_seats, internship_organizations(name_en)")
      .eq("active_status", "active")
      .gt("available_seats", 0)
      .order("available_seats", { ascending: false })
      .limit(20),
  ]);

  const authorIds = [
    ...(history.data ?? []).map((h) => h.changed_by),
    ...(comments.data ?? []).map((c) => c.author_id),
    kase.assigned_to,
  ];
  const names = await nameOf([...authorIds, kase.student_id]);
  const staff = await staffIds(authorIds.filter((v): v is string => Boolean(v)));
  const actorOf = (id: string | null): ActorKind =>
    !id ? "system" : id === kase.student_id ? "student" : staff.has(id) ? "owner" : "system";

  const timeline: TimelineEvent[] = [];
  for (const h of history.data ?? []) {
    const aiDriven = !h.changed_by || h.changed_by === kase.student_id;
    timeline.push({
      id: `st-${h.id}`,
      at: h.created_at,
      actor: aiDriven && h.to_status !== "submitted" ? "ai" : actorOf(h.changed_by),
      actorName: h.changed_by ? (names[h.changed_by] ?? null) : null,
      kind: "status",
      title: String(h.to_status),
      detail: h.note,
      internal: false,
    });
  }
  for (const c of comments.data ?? []) {
    timeline.push({
      id: `cm-${c.id}`,
      at: c.created_at,
      actor: actorOf(c.author_id),
      actorName: c.author_id ? (names[c.author_id] ?? null) : null,
      kind: c.is_internal ? "internal_note" : "message",
      title: c.is_internal ? "Internal note" : c.is_info_request ? "Information request" : "Case message",
      detail: c.body,
      internal: Boolean(c.is_internal),
    });
  }
  for (const m of messages.data ?? []) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    timeline.push({
      id: `ms-${m.id}`,
      at: m.created_at,
      actor: m.role === "user" ? "student" : "ai",
      actorName: m.role === "user" ? (names[kase.student_id] ?? null) : "Sanadi AI",
      kind: "chat",
      title: m.role === "user" ? "Student message (chat)" : "Sanadi reply (chat)",
      detail: typeof m.content === "string" ? m.content.slice(0, 1200) : null,
      internal: false,
    });
  }
  for (const a of audit.data ?? []) {
    timeline.push({
      id: `ia-${a.id}`,
      at: a.created_at,
      actor: a.actor_type === "human" ? "owner" : "ai",
      actorName: a.actor_type === "human" ? (names[a.actor_id ?? ""] ?? null) : "Sanadi AI",
      kind: "internship",
      title: String(a.event_type).replaceAll("_", " "),
      detail: a.details ? JSON.stringify(a.details) : null,
      internal: false,
    });
  }
  for (const n of notifications.data ?? []) {
    timeline.push({
      id: `nt-${n.id}`,
      at: n.created_at,
      actor: "system",
      actorName: null,
      kind: "notification",
      title: `Student notified — ${n.title ?? n.event_type}`,
      detail: n.body,
      internal: false,
    });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    case: kase,
    student: {
      id: kase.student_id,
      name: profile?.full_name ?? profile?.email ?? "—",
      email: profile?.email ?? null,
      studentNumber: studentProfile?.student_number ?? null,
      programme:
        (studentProfile?.academic_programs as { name_en?: string } | null)?.name_en ?? null,
      cgpa: studentProfile?.cumulative_gpa ?? null,
      credits: studentProfile?.completed_credit_hours ?? null,
    },
    assignedToName: kase.assigned_to ? (names[kase.assigned_to] ?? null) : null,
    assignment,
    conversation: conversation.data ?? null,
    timeline,
    alternatives: alternatives.data ?? [],
  };
}

export async function addInternalNote(caseId: string, actorId: string, body: string) {
  await assertCaseAccess(actorId, caseId);
  const { data, error } = await supabaseAdmin
    .from("case_comments")
    .insert({ case_id: caseId, author_id: actorId, body, is_internal: true })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "case_internal_note_added",
    entity_type: "case",
    entity_id: caseId,
    metadata: { note_id: data.id } as never,
  });
  return { ok: true, id: data.id };
}

/** Staff message that reaches the student in the case and in the linked chat. */
export async function sendStudentMessage(caseId: string, actorId: string, body: string) {
  await assertCaseAccess(actorId, caseId);
  const c = await loadCase(caseId);
  const { data: author } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", actorId)
    .maybeSingle();
  const authorName = author?.full_name ?? author?.email ?? "Service owner";

  const { error } = await supabaseAdmin
    .from("case_comments")
    .insert({ case_id: caseId, author_id: actorId, body, is_internal: false });
  if (error) throw new Error(error.message);

  const { data: kase } = await supabaseAdmin
    .from("cases")
    .select("related_conversation_id")
    .eq("id", caseId)
    .maybeSingle();
  if (kase?.related_conversation_id) {
    await checked(supabaseAdmin.from("messages").insert({
      conversation_id: kase.related_conversation_id,
      user_id: c.student_id,
      role: "assistant",
      content: body,
      language: (c.language as "en" | "ar") ?? "en",
      metadata: { sender: "service_owner", sender_name: authorName, case_id: caseId } as never,
    }), "staff_operations", "messages", false);
    await checked(supabaseAdmin
      .from("conversations")
      .update({ conversation_status: "waiting_student" })
      .eq("id", kase.related_conversation_id), "staff_operations", "conversations", false);
  }

  await checked(supabaseAdmin.from("cases").update({ last_activity_at: new Date().toISOString() }).eq("id", caseId), "staff_operations", "cases", false);
  await emitNotification({
    eventType: "case_message",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `msg:${caseId}:${Date.now()}`,
  });
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "case_student_message_sent",
    entity_type: "case",
    entity_id: caseId,
    metadata: { author: authorName } as never,
  });
  return { ok: true };
}

const OUTCOME: Record<string, { en: string; ar: string }> = {
  placement_allocated: { en: "Internship Placement Allocated", ar: "تم تخصيص فرصة تدريب" },
};

export async function setOwnerCaseStatus(
  caseId: string,
  actorId: string,
  status: OwnerCaseStatus,
  note?: string,
) {
  await assertCaseAccess(actorId, caseId);
  const c = await loadCase(caseId);
  const now = new Date().toISOString();
  const outcome = OUTCOME[status];
  await checked(supabaseAdmin
    .from("cases")
    .update({
      status: status as never,
      last_activity_at: now,
      ...(status === "resolved" ? { resolved_at: now } : {}),
      ...(status === "closed" ? { closed_at: now } : {}),
      ...(outcome ? { outcome_en: outcome.en, outcome_ar: outcome.ar } : {}),
    })
    .eq("id", caseId), "staff_operations", "cases", true);
  await checked(supabaseAdmin.from("case_status_history").insert({
    case_id: caseId,
    from_status: c.status as never,
    to_status: status as never,
    changed_by: actorId,
    note: note ?? null,
  }), "staff_operations", "case_status_history", false);
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "case_status_changed",
    entity_type: "case",
    entity_id: caseId,
    metadata: { from: c.status, to: status, note: note ?? null } as never,
  });
  await emitNotification({
    eventType: "case_status_changed",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number, status },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `status:${caseId}:${status}:${now}`,
  });
  return { ok: true };
}

export async function ownerReopenCase(caseId: string, actorId: string, reason: string) {
  await assertCaseAccess(actorId, caseId);
  const c = await loadCase(caseId);
  const { data: current } = await supabaseAdmin
    .from("cases")
    .select("reopened_count")
    .eq("id", caseId)
    .maybeSingle();
  await checked(supabaseAdmin
    .from("cases")
    .update({
      status: "reopened" as never,
      resolved_at: null,
      closed_at: null,
      reopened_count: (current?.reopened_count ?? 0) + 1,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", caseId), "staff_operations", "cases", true);
  await checked(supabaseAdmin.from("case_status_history").insert({
    case_id: caseId,
    from_status: c.status as never,
    to_status: "reopened" as never,
    changed_by: actorId,
    note: reason,
  }), "staff_operations", "case_status_history", false);
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "case_reopened_by_owner",
    entity_type: "case",
    entity_id: caseId,
    metadata: { reason } as never,
  });
  await emitNotification({
    eventType: "case_reopened",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/requests/${caseId}`,
    dedupeKey: `reopen:${caseId}:${Date.now()}`,
  });
  return { ok: true };
}

export async function setConversationStatus(
  caseId: string,
  actorId: string,
  status: ConversationStatus,
) {
  await assertCaseAccess(actorId, caseId);
  const { data: kase } = await supabaseAdmin
    .from("cases")
    .select("related_conversation_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!kase?.related_conversation_id) throw new Error("This case has no linked conversation");
  await checked(supabaseAdmin
    .from("conversations")
    .update({ conversation_status: status })
    .eq("id", kase.related_conversation_id), "staff_operations", "conversations", false);
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "conversation_status_changed",
    entity_type: "conversation",
    entity_id: kase.related_conversation_id,
    metadata: { status, case_id: caseId } as never,
  });
  return { ok: true };
}

/** Transaction-safe placement change that keeps the previous assignment in the audit trail. */
export async function ownerChangePlacement(
  caseId: string,
  actorId: string,
  assignmentId: string,
  newOpportunityId: string,
  reason: string,
) {
  await assertCaseAccess(actorId, caseId);
  const c = await loadCase(caseId);
  const { error } = await supabaseAdmin.rpc("change_internship_assignment", {
    _assignment_id: assignmentId,
    _new_opportunity_id: newOpportunityId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  await checked(supabaseAdmin.from("case_status_history").insert({
    case_id: caseId,
    from_status: c.status as never,
    to_status: "placement_allocated" as never,
    changed_by: actorId,
    note: `Placement changed by the service owner: ${reason}`,
  }), "staff_operations", "case_status_history", false);
  await checked(supabaseAdmin
    .from("cases")
    .update({
      status: "placement_allocated" as never,
      outcome_en: OUTCOME["placement_allocated"]!.en,
      outcome_ar: OUTCOME["placement_allocated"]!.ar,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", caseId), "staff_operations", "cases", true);
  await emitNotification({
    eventType: "internship_placement_changed",
    entityType: "case",
    entityId: caseId,
    recipientId: c.student_id,
    language: (c.language as "en" | "ar") ?? "en",
    vars: { case_number: c.case_number },
    actionUrl: `/internship`,
    dedupeKey: `placement-change:${assignmentId}:${Date.now()}`,
  });
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action: "internship_placement_changed",
    entity_type: "case",
    entity_id: caseId,
    metadata: { assignment_id: assignmentId, new_opportunity_id: newOpportunityId, reason } as never,
  });
  return { ok: true };
}
