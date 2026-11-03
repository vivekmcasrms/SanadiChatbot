/** Database-driven proactive alert engine with de-duplication. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification } from "./notify.server";

type Condition = {
  field_source: string;
  field_name: string;
  operator: string;
  comparison_value: unknown;
  condition_group: number;
};

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  const a = typeof actual === "string" && !Number.isNaN(Number(actual)) ? Number(actual) : actual;
  const b = typeof expected === "string" && !Number.isNaN(Number(expected)) ? Number(expected) : expected;
  switch (operator) {
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
    case "gt":
      return Number(a) > Number(b);
    case "gte":
      return Number(a) >= Number(b);
    case "lt":
      return Number(a) < Number(b);
    case "lte":
      return Number(a) <= Number(b);
    case "is_true":
      return Boolean(a);
    case "is_false":
      return !a;
    case "is_null":
      return a == null;
    case "not_null":
      return a != null;
    case "in":
      return Array.isArray(b) && (b as unknown[]).includes(a as never);
    default:
      return false;
  }
}

function render(template: string | null, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

type StudentSnapshot = Record<string, unknown> & { user_id: string };

async function loadStudentSnapshots(): Promise<StudentSnapshot[]> {
  const { data: students } = await supabaseAdmin
    .from("student_profiles")
    .select(
      "user_id, cumulative_gpa, completed_credit_hours, registered_credit_hours, academic_standing, expected_graduation_date, program_id, college_id, preferred_language",
    )
    .limit(500);

  const ids = (students ?? []).map((s) => s.user_id);
  if (!ids.length) return [];

  const [{ data: holds }, { data: reqs }, { data: docs }] = await Promise.all([
    supabaseAdmin
      .from("student_holds")
      .select("student_id, status, prevents_registration, prevents_graduation")
      .in("student_id", ids),
    supabaseAdmin.from("student_requirements").select("student_id, status, due_date").in("student_id", ids),
    supabaseAdmin.from("student_documents").select("student_id, verification_status").in("student_id", ids),
  ]);

  const holdCount = new Map<string, number>();
  const regBlock = new Map<string, number>();
  const gradBlock = new Map<string, number>();
  for (const h of holds ?? []) {
    if (h.status !== "active") continue;
    holdCount.set(h.student_id, (holdCount.get(h.student_id) ?? 0) + 1);
    if (h.prevents_registration) regBlock.set(h.student_id, (regBlock.get(h.student_id) ?? 0) + 1);
    if (h.prevents_graduation) gradBlock.set(h.student_id, (gradBlock.get(h.student_id) ?? 0) + 1);
  }
  const missingReq = new Map<string, number>();
  for (const r of reqs ?? [])
    if (r.status !== "met" && r.status !== "completed")
      missingReq.set(r.student_id, (missingReq.get(r.student_id) ?? 0) + 1);
  const missingDocs = new Map<string, number>();
  for (const d of docs ?? [])
    if (d.verification_status !== "verified")
      missingDocs.set(d.student_id, (missingDocs.get(d.student_id) ?? 0) + 1);

  return (students ?? []).map((s) => ({
    ...s,
    active_holds: holdCount.get(s.user_id) ?? 0,
    registration_blocking_holds: regBlock.get(s.user_id) ?? 0,
    graduation_blocking_holds: gradBlock.get(s.user_id) ?? 0,
    missing_requirements: missingReq.get(s.user_id) ?? 0,
    missing_documents: missingDocs.get(s.user_id) ?? 0,
  }));
}

/**
 * Evaluate every active alert rule against live student data.
 * De-duplicated: an identical condition never produces a second alert.
 */
export async function evaluateAlertRules(): Promise<{ created: number; skipped: number; rules: number }> {
  const { data: rules } = await supabaseAdmin
    .from("alert_rules")
    .select(
      "id, name, event_type, severity, title_template_en, title_template_ar, body_template_en, body_template_ar, action_label_en, action_label_ar, action_type, action_url, related_service_id, is_active",
    )
    .eq("is_active", true)
    .limit(100);

  const snapshots = await loadStudentSnapshots();
  let created = 0;
  let skipped = 0;

  for (const rule of rules ?? []) {
    const run = await supabaseAdmin
      .from("alert_rule_runs")
      .insert({ alert_rule_id: rule.id, records_evaluated: snapshots.length })
      .select("id")
      .maybeSingle();

    const { data: conditions } = await supabaseAdmin
      .from("alert_rule_conditions")
      .select("field_source, field_name, operator, comparison_value, condition_group")
      .eq("alert_rule_id", rule.id)
      .order("evaluation_order", { ascending: true });

    let ruleCreated = 0;
    let ruleSkipped = 0;

    if ((conditions ?? []).length) {
      for (const snap of snapshots) {
        const ok = (conditions as Condition[]).every((cond) =>
          compare(snap[cond.field_name], cond.operator, cond.comparison_value),
        );
        if (!ok) continue;

        const conditionKey = `${rule.event_type}`;
        const hash = JSON.stringify(
          (conditions as Condition[]).map((c) => `${c.field_name}=${String(snap[c.field_name])}`),
        );

        const { data: existing } = await supabaseAdmin
          .from("alert_deduplication")
          .select("id, current_status, last_condition_hash")
          .eq("student_id", snap.user_id)
          .eq("alert_rule_id", rule.id)
          .eq("condition_key", conditionKey)
          .maybeSingle();

        if (existing && existing.current_status === "active") {
          await supabaseAdmin
            .from("alert_deduplication")
            .update({ last_generated_at: new Date().toISOString() })
            .eq("id", existing.id);
          ruleSkipped += 1;
          skipped += 1;
          continue;
        }

        const vars = snap as Record<string, unknown>;
        const { data: alert } = await supabaseAdmin
          .from("student_alerts")
          .insert({
            student_id: snap.user_id,
            alert_rule_id: rule.id,
            alert_type: rule.event_type ?? "general",
            title_en: render(rule.title_template_en, vars),
            title_ar: render(rule.title_template_ar, vars),
            body_en: render(rule.body_template_en, vars),
            body_ar: render(rule.body_template_ar, vars),
            severity: rule.severity ?? "medium",
            related_service_id: rule.related_service_id,
            action_label_en: rule.action_label_en,
            action_label_ar: rule.action_label_ar,
            action_url: rule.action_url,
            status: "active",
          })
          .select("id")
          .maybeSingle();

        if (!alert) continue;

        await supabaseAdmin.from("alert_deduplication").upsert(
          {
            student_id: snap.user_id,
            alert_rule_id: rule.id,
            condition_key: conditionKey,
            source_record_id: alert.id,
            last_generated_at: new Date().toISOString(),
            last_condition_hash: hash,
            current_status: "active",
          },
          { onConflict: "student_id,alert_rule_id,condition_key" },
        );

        await emitNotification({
          eventType: "alert_generated",
          entityType: "alert",
          entityId: alert.id,
          recipientId: snap.user_id,
          vars: { title: render(rule.title_template_en, vars) },
          actionUrl: rule.action_url ?? "/my-notifications?tab=alerts",
          dedupeKey: `alert:${alert.id}:${snap.user_id}`,
        });

        ruleCreated += 1;
        created += 1;
      }
    }

    if (run.data?.id) {
      await supabaseAdmin
        .from("alert_rule_runs")
        .update({
          completed_at: new Date().toISOString(),
          alerts_created: ruleCreated,
          alerts_skipped: ruleSkipped,
          run_status: "completed",
        })
        .eq("id", run.data.id);
    }
  }

  return { created, skipped, rules: rules?.length ?? 0 };
}

/**
 * Close out alerts whose underlying condition no longer holds.
 * An alert is never completed just because it was opened.
 */
export async function reconcileAlertConditions(): Promise<number> {
  const snapshots = await loadStudentSnapshots();
  const byStudent = new Map(snapshots.map((s) => [s.user_id, s]));

  const { data: dedup } = await supabaseAdmin
    .from("alert_deduplication")
    .select("id, student_id, alert_rule_id, source_record_id, current_status")
    .eq("current_status", "active")
    .limit(1000);

  let resolved = 0;
  for (const row of dedup ?? []) {
    if (!row.alert_rule_id) continue;
    const { data: conditions } = await supabaseAdmin
      .from("alert_rule_conditions")
      .select("field_name, operator, comparison_value")
      .eq("alert_rule_id", row.alert_rule_id);
    const snap = byStudent.get(row.student_id);
    if (!snap || !(conditions ?? []).length) continue;
    const stillTrue = (conditions ?? []).every((c) =>
      compare(snap[c.field_name], c.operator, c.comparison_value),
    );
    if (stillTrue) continue;
    await supabaseAdmin.from("alert_deduplication").update({ current_status: "resolved" }).eq("id", row.id);
    if (row.source_record_id) {
      await supabaseAdmin
        .from("student_alerts")
        .update({ status: "resolved", action_completed_at: new Date().toISOString() })
        .eq("id", row.source_record_id);
    }
    resolved += 1;
  }
  return resolved;
}