import { auditInsert } from "@/lib/exceptions/handle.server";
/**
 * Admin oversight write-paths.
 *
 * Deliberately narrow: an admin can nudge, escalate, move or annotate a case —
 * they never resolve it in the owner's place. Every action produces three
 * artefacts so accountability survives the conversation: a notification to the
 * responsible party, an oversight record, and an audit-log entry.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification, notifyUnitStaff } from "@/lib/ops/notify.server";

export type OversightAction = "remind_owner" | "escalate" | "reassign" | "note";

/** A second reminder within this window is suppressed — oversight must not spam owners. */
const REMINDER_COOLDOWN_MINUTES = 240;

type Input = {
  caseId: string;
  actorId: string;
  action: OversightAction;
  reason: string | null;
  newUnitId: string | null;
  newOwnerId: string | null;
};

async function logAudit(actorId: string, action: string, caseId: string, metadata: Record<string, unknown>) {
  await auditInsert(supabaseAdmin, {
    actor_id: actorId,
    action,
    entity_type: "case",
    entity_id: caseId,
    metadata: metadata as never,
  });
}

export async function performOversightAction(input: Input): Promise<{ ok: boolean; message: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, title, service_unit_id, assigned_to, escalation_level, current_responsible_actor, language",
    )
    .eq("id", input.caseId)
    .maybeSingle();
  if (error || !row) throw new Error("Case not found");

  if (input.action === "remind_owner") {
    const since = new Date(Date.now() - REMINDER_COOLDOWN_MINUTES * 60_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("case_oversight_actions")
      .select("id")
      .eq("case_id", input.caseId)
      .eq("action_type", "remind_owner")
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length) {
      return {
        ok: false,
        message: "A reminder was already sent for this case in the last 4 hours.",
      };
    }

    await notifyUnitStaff(row.service_unit_id, row.assigned_to, {
      eventType: "sla_overdue",
      entityType: "case",
      entityId: row.id,
      actionUrl: `/requests/${row.id}`,
      vars: { case_number: row.case_number },
      dedupeKey: `oversight-remind:${row.id}:${Math.floor(Date.now() / (REMINDER_COOLDOWN_MINUTES * 60_000))}`,
    });
  }

  if (input.action === "escalate") {
    const nextLevel = (row.escalation_level ?? 0) + 1;
    await supabaseAdmin
      .from("cases")
      .update({
        escalation_level: nextLevel,
        escalated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    await supabaseAdmin.from("escalation_actions").insert({
      case_id: row.id,
      escalation_level: nextLevel,
      previous_unit_id: row.service_unit_id,
      target_unit_id: row.service_unit_id,
      previous_assignee_id: row.assigned_to,
      reason: input.reason ?? "Admin oversight escalation",
      triggered_by: input.actorId,
    });

    await notifyUnitStaff(row.service_unit_id, row.assigned_to, {
      eventType: "case_escalated",
      entityType: "case",
      entityId: row.id,
      actionUrl: `/requests/${row.id}`,
      vars: { case_number: row.case_number },
    });
  }

  if (input.action === "reassign") {
    if (!input.newUnitId && !input.newOwnerId) throw new Error("Choose a new unit or owner");
    if (!input.reason?.trim()) throw new Error("A reason is required for reassignment");

    await supabaseAdmin
      .from("cases")
      .update({
        service_unit_id: input.newUnitId ?? row.service_unit_id,
        assigned_to: input.newOwnerId ?? null,
        current_responsible_actor: input.newOwnerId ? "specific_officer" : "service_owner",
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (input.newOwnerId) {
      await emitNotification({
        eventType: "new_assignment",
        entityType: "case",
        entityId: row.id,
        recipientId: input.newOwnerId,
        actionUrl: `/requests/${row.id}`,
        vars: { case_number: row.case_number },
      });
    }
  }

  await supabaseAdmin.from("case_oversight_actions").insert({
    case_id: row.id,
    action_type: input.action,
    actor_id: input.actorId,
    reason: input.reason,
    previous_unit_id: row.service_unit_id,
    previous_owner_id: row.assigned_to,
    new_unit_id: input.newUnitId,
    new_owner_id: input.newOwnerId,
    sla_treatment: input.action === "reassign" ? "sla_continues" : null,
  });

  await logAudit(input.actorId, `oversight_${input.action}`, row.id, {
    reason: input.reason,
    newUnitId: input.newUnitId,
    newOwnerId: input.newOwnerId,
  });

  const messages: Record<OversightAction, string> = {
    remind_owner: "Reminder sent to the responsible unit.",
    escalate: "Case escalated and the unit notified.",
    reassign: "Case reassigned. SLA clock continues.",
    note: "Oversight note recorded.",
  };
  return { ok: true, message: messages[input.action] };
}

/** Closes the loop flag once the student has genuinely been informed. */
export async function confirmResolutionCommunicated(caseId: string, actorId: string) {
  await supabaseAdmin
    .from("cases")
    .update({ resolution_communicated_at: new Date().toISOString() })
    .eq("id", caseId);
  await supabaseAdmin.from("case_oversight_actions").insert({
    case_id: caseId,
    action_type: "closure_confirmed",
    actor_id: actorId,
  });
  await logAudit(actorId, "oversight_closure_confirmed", caseId, {});
}
