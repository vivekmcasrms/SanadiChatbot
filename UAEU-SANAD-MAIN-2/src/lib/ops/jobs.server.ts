/** Idempotent scheduled jobs: SLA sweeps, escalations, alert generation, reminders. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateSla } from "./sla.server";
import { escalateCase } from "./routing.server";
import { evaluateAlertRules, reconcileAlertConditions } from "./alerts.server";
import { emitNotification } from "./notify.server";

export type JobName =
  | "sla_sweep"
  | "case_hygiene"
  | "auto_escalation"
  | "alert_generation"
  | "info_request_reminders"
  | "satisfaction_surveys"
  | "suggestion_review_reminders"
  | "ai_case_manager"
  | "document_retention"
  | "service_open_reminders"
  | "appointment_reminders"
  | "learning_detection"
  | "routing_learning"
  | "all";

type JobResult = { processed: number; details: Record<string, number> };

export type JobRunResult = {
  job: string;
  processed?: number;
  details?: Record<string, number>;
  error?: string;
  results?: JobRunResult[];
};

async function withRun(job: string, fn: () => Promise<JobResult>) {
  const { data: run } = await supabaseAdmin
    .from("scheduled_job_runs")
    .insert({ job_name: job, status: "running" })
    .select("id")
    .maybeSingle();
  try {
    const result = await fn();
    if (run?.id) {
      await supabaseAdmin
        .from("scheduled_job_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "completed",
          records_processed: result.processed,
          successes: result.processed,
          failures: 0,
        })
        .eq("id", run.id);
    }
    return { job, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run?.id) {
      await supabaseAdmin
        .from("scheduled_job_runs")
        .update({ completed_at: new Date().toISOString(), status: "failed", failures: 1, error_summary: message })
        .eq("id", run.id);
    }
    return { job, processed: 0, details: {}, error: message };
  }
}

/**
 * Repairs open cases that never completed intake: no responsible officer, or no
 * SLA deadlines. Both make a case invisible to the SLA sweep and to owner queues.
 */
async function caseHygiene(): Promise<JobResult> {
  const { data: rows } = await supabaseAdmin
    .from("cases")
    .select("id, assigned_to, first_response_due_at, resolution_due_at")
    .not("status", "in", "(closed,resolved,withdrawn,rejected,duplicate)")
    .limit(500);

  const pending = (rows ?? []).filter((c) => !c.assigned_to || !c.first_response_due_at || !c.resolution_due_at);
  let routed = 0;
  let slaApplied = 0;

  for (const c of pending) {
    if (!c.assigned_to) {
      const { routeCase } = await import("./routing.server");
      const result = await routeCase(c.id);
      if (result.assigneeId) routed += 1;
      slaApplied += 1; // routeCase applies the SLA itself
      continue;
    }
    const { applySlaToCase } = await import("./sla.server");
    if (await applySlaToCase(c.id)) slaApplied += 1;
  }

  return { processed: pending.length, details: { routed, slaApplied } };
}

/** Escalate cases that breached their resolution deadline and are not yet escalated for that breach. */
async function autoEscalation(): Promise<JobResult> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("cases")
    .select("id, escalation_level, resolution_due_at, first_response_at, first_response_due_at, sla_state")
    .not("status", "in", "(closed,resolved)")
    .is("sla_paused_at", null)
    .lt("resolution_due_at", nowIso)
    .limit(500);

  let escalated = 0;
  for (const c of rows ?? []) {
    // one escalation per level per breach — level cap prevents runaway loops
    if ((c.escalation_level ?? 0) >= 3) continue;
    const ok = await escalateCase({
      caseId: c.id,
      reason: "Resolution deadline breached",
      triggerType: "sla_breach",
    });
    if (ok) escalated += 1;
  }
  return { processed: rows?.length ?? 0, details: { escalated } };
}

/** Remind students about open information requests, and expire those long past due. */
async function infoRequestReminders(): Promise<JobResult> {
  const { data: reqs } = await supabaseAdmin
    .from("case_information_requests")
    .select("id, case_id, information_required, due_at, reminder_days, status")
    .eq("status", "pending")
    .limit(500);

  let reminded = 0;
  let expired = 0;
  const now = Date.now();

  for (const r of reqs ?? []) {
    const { data: c } = await supabaseAdmin
      .from("cases")
      .select("id, case_number, student_id, language")
      .eq("id", r.case_id)
      .maybeSingle();
    if (!c) continue;

    const due = r.due_at ? new Date(r.due_at).getTime() : null;
    if (due && now > due) {
      await supabaseAdmin.from("case_information_requests").update({ status: "expired" }).eq("id", r.id);
      expired += 1;
      continue;
    }
    if (!due) continue;
    const daysLeft = Math.ceil((due - now) / 86_400_000);
    if (daysLeft > (r.reminder_days ?? 3)) continue;

    await emitNotification({
      eventType: "information_requested",
      entityType: "case",
      entityId: c.id,
      recipientId: c.student_id,
      language: (c.language as "en" | "ar") ?? "en",
      vars: { case_number: c.case_number, days: daysLeft },
      actionUrl: `/requests/${c.id}`,
      dedupeKey: `inforeq:${r.id}:d${daysLeft}`,
    });
    reminded += 1;
  }
  return { processed: reqs?.length ?? 0, details: { reminded, expired } };
}

/** Invite students to rate cases closed in the last 14 days that have no feedback yet. */
async function satisfactionSurveys(): Promise<JobResult> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, student_id, language, closed_at")
    .eq("status", "closed")
    .gte("closed_at", since)
    .limit(500);

  let sent = 0;
  for (const c of rows ?? []) {
    const { data: fb } = await supabaseAdmin
      .from("case_feedback")
      .select("id")
      .eq("case_id", c.id)
      .maybeSingle();
    if (fb) continue;
    await emitNotification({
      eventType: "satisfaction_survey",
      entityType: "case",
      entityId: c.id,
      recipientId: c.student_id,
      language: (c.language as "en" | "ar") ?? "en",
      vars: { case_number: c.case_number },
      actionUrl: `/requests/${c.id}`,
      dedupeKey: `survey:${c.id}`,
    });
    sent += 1;
  }
  return { processed: rows?.length ?? 0, details: { sent } };
}

/** Notify students when a service they asked about has opened. */
async function serviceOpenReminders(): Promise<JobResult> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("student_service_reminders")
    .select("id, student_id, service_id, reminder_type, scheduled_for, university_services(code, name_en, name_ar)")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .limit(500);

  let sent = 0;
  for (const r of rows ?? []) {
    const svc = (r as unknown as { university_services?: { code: string; name_en: string; name_ar: string } | null })
      .university_services;
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("preferred_language")
      .eq("id", r.student_id)
      .maybeSingle();
    const lang = (profile?.preferred_language as "en" | "ar") ?? "en";
    const ok = await emitNotification({
      eventType: "service_window_open",
      entityType: "university_service",
      entityId: r.service_id,
      recipientId: r.student_id,
      language: lang,
      vars: { service: (lang === "ar" ? svc?.name_ar : svc?.name_en) ?? svc?.code ?? "" },
      actionUrl: "/assistant",
      dedupeKey: `service-open:${r.id}`,
    });
    await supabaseAdmin
      .from("student_service_reminders")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", r.id);
    if (ok) sent += 1;
  }
  return { processed: rows?.length ?? 0, details: { sent } };
}

/**
 * Reminds students and staff about appointments starting in the next 24 hours.
 * The dedupe key makes repeated runs harmless.
 */
async function appointmentReminders(): Promise<JobResult> {
  const now = Date.now();
  const from = new Date(now).toISOString();
  const to = new Date(now + 26 * 3600_000).toISOString();

  const { data: rows } = await supabaseAdmin
    .from("student_appointments")
    .select(
      "id, student_id, status, appointment_slots:slot_id (start_time, location, meeting_link, staff_profile_id, appointment_types:appointment_type_id (name_en, name_ar, service_unit_id, service_units:service_unit_id (name_en, name_ar)))",
    )
    .in("status", ["booked", "confirmed", "pending_approval"])
    .limit(500);

  let sent = 0;
  for (const a of rows ?? []) {
    const slot = a.appointment_slots as unknown as {
      start_time: string;
      location: string | null;
      meeting_link: string | null;
      staff_profile_id: string | null;
      appointment_types: {
        name_en: string;
        name_ar: string;
        service_unit_id: string | null;
        service_units: { name_en: string; name_ar: string } | null;
      } | null;
    } | null;
    if (!slot?.start_time) continue;
    if (slot.start_time < from || slot.start_time > to) continue;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("preferred_language, full_name")
      .eq("id", a.student_id)
      .maybeSingle();
    const lang = (profile?.preferred_language as "en" | "ar") ?? "en";
    const unit = slot.appointment_types?.service_units;
    const when = new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Dubai",
    }).format(new Date(slot.start_time));
    const vars = {
      when,
      staff_name: "",
      unit: (lang === "ar" ? unit?.name_ar : unit?.name_en) ?? "",
      location: slot.meeting_link ?? slot.location ?? "",
    };
    const ok = await emitNotification({
      eventType: "appointment_reminder",
      entityType: "student_appointment",
      entityId: a.id,
      recipientId: a.student_id,
      language: lang,
      vars,
      actionUrl: "/requests",
      serviceUnitId: slot.appointment_types?.service_unit_id ?? null,
      dedupeKey: `appointment-reminder:${a.id}`,
    });
    if (slot.staff_profile_id) {
      await emitNotification({
        eventType: "appointment_reminder",
        entityType: "student_appointment",
        entityId: a.id,
        recipientId: slot.staff_profile_id,
        language: "en",
        vars: { ...vars, staff_name: profile?.full_name ?? "" },
        actionUrl: "/owner-console",
        serviceUnitId: slot.appointment_types?.service_unit_id ?? null,
        dedupeKey: `appointment-reminder:${a.id}:staff`,
      });
    }
    if (ok) sent += 1;
  }
  return { processed: rows?.length ?? 0, details: { sent } };
}

/** Run one job (or every job). All jobs are safe to run repeatedly. */
export async function runScheduledJob(job: JobName): Promise<JobRunResult> {
  switch (job) {
    case "case_hygiene":
      return withRun("case_hygiene", caseHygiene);
    case "sla_sweep":
      return withRun("sla_sweep", async () => {
        const r = await evaluateSla();
        return { processed: r.processed, details: { events: r.events } };
      });
    case "auto_escalation":
      return withRun("auto_escalation", autoEscalation);
    case "alert_generation":
      return withRun("alert_generation", async () => {
        const r = await evaluateAlertRules();
        const resolved = await reconcileAlertConditions();
        return { processed: r.rules, details: { created: r.created, skipped: r.skipped, resolved } };
      });
    case "info_request_reminders":
      return withRun("info_request_reminders", infoRequestReminders);
    case "satisfaction_surveys":
      return withRun("satisfaction_surveys", satisfactionSurveys);
    case "ai_case_manager":
      return withRun("ai_case_manager", async () => {
        const { runCaseManagerSweep } = await import("@/lib/automation/case-manager.server");
        return runCaseManagerSweep();
      });
    case "document_retention":
      return withRun("document_retention", async () => {
        const { sweepExpiredDocuments } = await import("@/lib/documents/retention.server");
        return sweepExpiredDocuments();
      });
    case "service_open_reminders":
      return withRun("service_open_reminders", serviceOpenReminders);
    case "appointment_reminders":
      return withRun("appointment_reminders", appointmentReminders);
    case "routing_learning":
      return withRun("routing_learning", async () => {
        const { buildRoutingCandidates, evaluateLearnedRules } = await import(
          "@/lib/learning/routing-candidates.server"
        );
        const built = await buildRoutingCandidates({});
        const evaluated = await evaluateLearnedRules();
        return {
          processed: built.examined,
          details: {
            clusters: built.clusters,
            proposed: built.proposed,
            shadowed: built.shadowed,
            promoted: evaluated.promoted,
            paused: evaluated.paused,
          },
        };
      });
    case "learning_detection":
      return withRun("learning_detection", async () => {
        const { detectLearningCandidates } = await import("@/lib/learning/detect.server");
        return detectLearningCandidates({});
      });
    case "suggestion_review_reminders":
      return withRun("suggestion_review_reminders", async () => {
        const { suggestionReviewReminders } = await import("./suggestion-actions.server");
        return suggestionReviewReminders();
      });
    case "all":
    default: {
      const results: JobRunResult[] = [];
      for (const name of [
        "ai_case_manager",
        "case_hygiene",
        "sla_sweep",
        "auto_escalation",
        "alert_generation",
        "info_request_reminders",
        "satisfaction_surveys",
        "suggestion_review_reminders",
        "document_retention",
        "service_open_reminders",
        "appointment_reminders",
        "learning_detection",
        "routing_learning",
      ] as JobName[]) {
        results.push(await runScheduledJob(name));
      }
      return { job: "all", results };
    }
  }
}