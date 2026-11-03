/** Server-side SLA calculation and evaluation. Deadlines are never computed in the browser. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addWorkingDays, addWorkingHours, loadCalendar } from "./calendar.server";
import { emitNotification, notifyUnitStaff } from "./notify.server";

export const SLA_THRESHOLDS = [50, 75, 90, 100] as const;

export type SlaState =
  | "on_track"
  | "due_soon"
  | "first_response_overdue"
  | "resolution_overdue"
  | "escalated"
  | "paused"
  | "completed";

type SlaRule = { acknowledge_hours: number; resolve_days: number };

const DEFAULT_RULE: Record<string, SlaRule> = {
  complaint: { acknowledge_hours: 24, resolve_days: 10 },
  query: { acknowledge_hours: 8, resolve_days: 3 },
  suggestion: { acknowledge_hours: 48, resolve_days: 20 },
  service_request: { acknowledge_hours: 24, resolve_days: 5 },
  // Alerts are never a generic 2-day complaint: the urgency factor below
  // compresses these further for high and critical severities.
  alert: { acknowledge_hours: 4, resolve_days: 2 },
};

const URGENCY_FACTOR: Record<string, number> = { critical: 0.25, high: 0.5, medium: 1, low: 1.5 };

export async function resolveSlaRule(
  caseType: string,
  urgency: string,
  serviceUnitId: string | null,
): Promise<SlaRule> {
  const { data } = await supabaseAdmin
    .from("service_level_rules")
    .select("acknowledge_hours, resolve_days, service_unit_id, urgency")
    .eq("case_type", caseType as never)
    .limit(50);

  const rows = data ?? [];
  const exact = rows.find((r) => r.service_unit_id === serviceUnitId && r.urgency === urgency);
  const byUnit = rows.find((r) => r.service_unit_id === serviceUnitId);
  const byUrgency = rows.find((r) => r.urgency === urgency);
  const any = rows[0];
  const picked = exact ?? byUnit ?? byUrgency ?? any;

  const base = picked
    ? { acknowledge_hours: picked.acknowledge_hours, resolve_days: picked.resolve_days }
    : (DEFAULT_RULE[caseType] ?? DEFAULT_RULE["query"]!);

  const factor = URGENCY_FACTOR[urgency] ?? 1;
  return {
    acknowledge_hours: Math.max(1, Math.round(base.acknowledge_hours * factor)),
    resolve_days: Math.max(1, Math.round(base.resolve_days * factor)),
  };
}

/** Compute and persist first-response and resolution deadlines for a case. */
export async function applySlaToCase(caseId: string): Promise<{ firstResponseDueAt: string; resolutionDueAt: string } | null> {
  const { data: row } = await supabaseAdmin
    .from("cases")
    .select("id, case_type, urgency, service_unit_id, created_at")
    .eq("id", caseId)
    .maybeSingle();
  if (!row) return null;

  const rule = await resolveSlaRule(row.case_type, row.urgency, row.service_unit_id);
  const cal = await loadCalendar();
  const start = new Date(row.created_at);
  const firstResponseDueAt = addWorkingHours(cal, start, rule.acknowledge_hours).toISOString();
  const resolutionDueAt = addWorkingDays(cal, start, rule.resolve_days).toISOString();

  await supabaseAdmin
    .from("cases")
    .update({
      first_response_due_at: firstResponseDueAt,
      resolution_due_at: resolutionDueAt,
      due_at: resolutionDueAt,
      expected_resolution_date: resolutionDueAt.slice(0, 10),
    })
    .eq("id", caseId);

  return { firstResponseDueAt, resolutionDueAt };
}

export function deriveSlaState(row: {
  status: string;
  first_response_at: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  sla_paused_at: string | null;
  escalation_level: number;
}): SlaState {
  if (row.status === "closed" || row.status === "resolved") return "completed";
  if (row.sla_paused_at) return "paused";
  const now = Date.now();
  if (!row.first_response_at && row.first_response_due_at && new Date(row.first_response_due_at).getTime() < now) {
    return "first_response_overdue";
  }
  if (row.resolution_due_at && new Date(row.resolution_due_at).getTime() < now) return "resolution_overdue";
  if (row.escalation_level > 0) return "escalated";
  if (row.resolution_due_at) {
    const due = new Date(row.resolution_due_at).getTime();
    if (due - now < 48 * 3_600_000) return "due_soon";
  }
  return "on_track";
}

function pct(start: number, due: number, now: number) {
  if (due <= start) return 100;
  return Math.round(((now - start) / (due - start)) * 100);
}

/** Idempotent SLA sweep: writes case_sla_events (uniquely keyed) and notifies once per threshold. */
export async function evaluateSla(): Promise<{ processed: number; events: number }> {
  const { data: rows } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, student_id, status, urgency, escalation_level, service_unit_id, assigned_to, created_at, first_response_at, first_response_due_at, resolution_due_at, sla_paused_at, sla_state, language",
    )
    .eq("is_demo", false)
    .not("status", "in", "(closed,resolved,withdrawn,rejected,duplicate)")
    .limit(1000);

  let events = 0;
  const now = Date.now();

  for (const c of rows ?? []) {
    const state = deriveSlaState(c);
    if (state !== c.sla_state) {
      await supabaseAdmin.from("cases").update({ sla_state: state }).eq("id", c.id);
    }
    if (c.sla_paused_at) continue;

    const started = new Date(c.created_at).getTime();
    const checks: { due: string | null; soon: string; over: string; skip: boolean }[] = [
      {
        due: c.first_response_due_at,
        soon: "first_response_due_soon",
        over: "first_response_overdue",
        skip: Boolean(c.first_response_at),
      },
      { due: c.resolution_due_at, soon: "resolution_due_soon", over: "resolution_overdue", skip: false },
    ];

    for (const check of checks) {
      if (check.skip || !check.due) continue;
      const p = pct(started, new Date(check.due).getTime(), now);
      for (const threshold of SLA_THRESHOLDS) {
        if (p < threshold) continue;
        const eventType = threshold >= 100 ? check.over : check.soon;
        const { error } = await supabaseAdmin
          .from("case_sla_events")
          .insert({ case_id: c.id, event_type: eventType, threshold_percentage: threshold });
        if (error) continue; // duplicate → already handled (idempotent)
        events += 1;

        await notifyUnitStaff(c.service_unit_id, c.assigned_to, {
          eventType: threshold >= 100 ? "sla_overdue" : "sla_warning",
          entityType: "case",
          entityId: c.id,
          vars: { case_number: c.case_number, threshold },
          actionUrl: `/requests/${c.id}`,
          dedupeKey: `sla:${c.id}:${eventType}:${threshold}`,
        });

        if (threshold >= 100) {
          await emitNotification({
            eventType: "case_delayed",
            entityType: "case",
            entityId: c.id,
            recipientId: c.student_id,
            language: (c.language as "en" | "ar") ?? "en",
            vars: { case_number: c.case_number, due: new Date(check.due).toLocaleDateString() },
            actionUrl: `/requests/${c.id}`,
            dedupeKey: `delay:${c.id}:${eventType}`,
          });
        }
      }
    }
  }

  return { processed: rows?.length ?? 0, events };
}