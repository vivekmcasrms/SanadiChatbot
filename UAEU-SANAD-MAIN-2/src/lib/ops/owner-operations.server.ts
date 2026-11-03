/**
 * Follow-up and SLA operations for the Service Owner console.
 * Reads run through the caller's RLS-scoped client, so a Service Owner only
 * ever sees cases belonging to their own service unit.
 */
import type { Db } from "../agent/tools.server";

export type OwnerOpsItem = {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  urgency: string;
  caseType: string;
  studentName: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  lastActionEn: string | null;
  lastActionAr: string | null;
  nextActionEn: string | null;
  nextActionAr: string | null;
  nextActionAt: string | null;
  dueAt: string | null;
  /** Hours left against the resolution deadline; negative = breached. */
  slaHours: number | null;
  slaState: "on_track" | "attention" | "critical" | "breached" | "none";
  responsible: "ai" | "owner" | "student" | "external";
  attentionCategory: string | null;
};

const OPEN_EXCLUDE = "(closed,resolved,withdrawn,rejected,duplicate)";

function slaStateFor(hours: number | null): OwnerOpsItem["slaState"] {
  if (hours == null) return "none";
  if (hours < 0) return "breached";
  if (hours <= 8) return "critical";
  if (hours <= 24) return "attention";
  return "on_track";
}

export async function loadOwnerOperations(db: Db, unitIds?: string[]) {
  let query = db
    .from("cases")
    .select(
      "id, case_number, case_type, title, status, urgency, student_id, service_unit_id, resolution_due_at, first_response_due_at, escalation_level, last_activity_at, created_at",
    )
    .not("status", "in", OPEN_EXCLUDE);
  if (unitIds && unitIds.length > 0) query = query.in("service_unit_id", unitIds);
  const { data: cases } = await query.order("resolution_due_at", { ascending: true }).limit(300);


  const rows = cases ?? [];
  const ids = rows.map((c) => c.id);
  const studentIds = [...new Set(rows.map((c) => c.student_id).filter(Boolean))] as string[];
  const caseUnitIds = [...new Set(rows.map((c) => c.service_unit_id).filter(Boolean))] as string[];

  const [{ data: states }, { data: people }, { data: units }] = await Promise.all([
    ids.length
      ? db
          .from("case_automation_state")
          .select(
            "case_id, ai_status, attention_category, next_action_en, next_action_ar, next_action_at, automation_paused, last_automated_at",
          )
          .in("case_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    studentIds.length
      ? db.from("profiles").select("id, full_name, email").in("id", studentIds)
      : Promise.resolve({ data: [] as never[] }),
    caseUnitIds.length
      ? db.from("service_units").select("id, name_en, name_ar").in("id", caseUnitIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  type StateRow = {
    case_id: string;
    ai_status: string | null;
    attention_category: string | null;
    next_action_en: string | null;
    next_action_ar: string | null;
    next_action_at: string | null;
    automation_paused: boolean | null;
    last_automated_at: string | null;
  };
  const stateFor = new Map<string, StateRow>(
    ((states ?? []) as StateRow[]).map((s) => [s.case_id, s]),
  );
  const nameFor = new Map<string, string | null>(
    ((people ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name ?? p.email,
    ]),
  );
  const unitFor = new Map<string, { id: string; name_en: string; name_ar: string }>(
    ((units ?? []) as { id: string; name_en: string; name_ar: string }[]).map((u) => [u.id, u]),
  );

  const now = Date.now();

  const items: OwnerOpsItem[] = rows.map((c) => {
    const st = stateFor.get(c.id);
    const due = c.resolution_due_at ? new Date(c.resolution_due_at).getTime() : null;
    const slaHours = due == null ? null : Math.round(((due - now) / 3_600_000) * 10) / 10;
    const unit = c.service_unit_id ? unitFor.get(c.service_unit_id) : undefined;

    const responsible: OwnerOpsItem["responsible"] =
      c.status === "awaiting_student" || c.status === "student_confirmation"
        ? "student"
        : c.status === "waiting_external"
          ? "external"
          : st?.attention_category || st?.automation_paused
            ? "owner"
            : "ai";

    return {
      id: c.id,
      caseNumber: c.case_number,
      title: c.title,
      status: c.status,
      urgency: c.urgency,
      caseType: c.case_type,
      studentName: c.student_id ? (nameFor.get(c.student_id) ?? null) : null,
      unitNameEn: unit?.name_en ?? null,
      unitNameAr: unit?.name_ar ?? null,
      lastActionEn: st?.ai_status ? st.ai_status.replace(/_/g, " ") : null,
      lastActionAr: st?.ai_status ? st.ai_status.replace(/_/g, " ") : null,
      nextActionEn: st?.next_action_en ?? null,
      nextActionAr: st?.next_action_ar ?? null,
      nextActionAt: st?.next_action_at ?? null,
      dueAt: c.resolution_due_at,
      slaHours,
      slaState: slaStateFor(slaHours),
      responsible,
      attentionCategory: st?.attention_category ?? null,
    };
  });

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const isDueToday = (i: OwnerOpsItem) =>
    i.dueAt != null && new Date(i.dueAt).getTime() >= now && new Date(i.dueAt).getTime() <= endOfDay.getTime();

  const followUp = {
    dueToday: items.filter(isDueToday),
    overdue: items.filter((i) => i.slaState === "breached"),
    waitingStudent: items.filter((i) => i.responsible === "student"),
    waitingExternal: items.filter((i) => i.responsible === "external"),
    aiScheduled: items.filter((i) => i.responsible === "ai" && i.nextActionAt != null),
    needsOwnerAction: items.filter((i) => i.responsible === "owner"),
  };

  const sla = {
    breached: items.filter((i) => i.slaState === "breached"),
    critical: items.filter((i) => i.slaState === "critical"),
    attention: items.filter((i) => i.slaState === "attention"),
    onTrack: items.filter((i) => i.slaState === "on_track").length,
    escalated: rows.filter((c) => (c.escalation_level ?? 0) > 0 || c.status === "escalated").map((c) => c.id),
    aiHandled: items.filter((i) => i.responsible === "ai").length,
    humanNeeded: items.filter((i) => i.responsible === "owner").length,
  };

  const escalations = items.filter(
    (i) => i.status === "escalated" || i.attentionCategory === "escalation_review",
  );

  return { items, followUp, sla, escalations };
}
