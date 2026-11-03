/** Idempotent scheduled jobs: SLA sweeps, escalations, alert generation, reminders. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateSla } from "./sla.server";
import { escalateCase } from "./routing.server";
import { evaluateAlertRules, reconcileAlertConditions } from "./alerts.server";
import { emitNotification } from "./notify.server";
import { chunk, makeJobStats, pagedRows, type JobStats } from "./job-batching.server";
import { inReminderWindow, infoRequestAction } from "./job-batching";

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

type JobResult = {
  processed: number;
  details: Record<string, number>;
  skipped?: number;
  errors?: number;
  pages?: number;
  truncated?: boolean;
};

export type JobRunResult = {
  job: string;
  processed?: number;
  details?: Record<string, number>;
  error?: string;
  durationMs?: number;
  results?: JobRunResult[];
};

/** Each job stops paging after this budget and records `truncated`; the next run continues. */
const JOB_BUDGET_MS = 25_000;
const deadline = () => Date.now() + JOB_BUDGET_MS;

async function withRun(job: string, fn: () => Promise<JobResult>): Promise<JobRunResult> {
  const started = Date.now();
  const { data: run } = await supabaseAdmin
    .from("scheduled_job_runs")
    .insert({ job_name: job, status: "running" })
    .select("id")
    .maybeSingle();
  try {
    const result = await fn();
    const durationMs = Date.now() - started;
    const errors = result.errors ?? 0;
    if (run?.id) {
      await supabaseAdmin
        .from("scheduled_job_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "completed",
          records_processed: result.processed,
          successes: Math.max(0, result.processed - (result.skipped ?? 0) - errors),
          failures: errors,
          skipped: result.skipped ?? 0,
          pages: result.pages ?? 0,
          truncated: result.truncated ?? false,
          duration_ms: durationMs,
          details: result.details,
        })
        .eq("id", run.id);
    }
    return { job, processed: result.processed, details: result.details, durationMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - started;
    if (run?.id) {
      await supabaseAdmin
        .from("scheduled_job_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          failures: 1,
          error_summary: message,
          duration_ms: durationMs,
        })
        .eq("id", run.id);
    }
    return { job, processed: 0, details: {}, error: message, durationMs };
  }
}

const bump = (s: JobStats, key: string, n = 1) => {
  s.details[key] = (s.details[key] ?? 0) + n;
};
/** True when the run budget is spent; marks the run truncated so the next run continues. */
const outOfTime = (s: JobStats, until: number) => {
  if (Date.now() <= until) return false;
  s.truncated = true;
  return true;
};
const statsResult = (s: JobStats): JobResult => ({ ...s });
const pageOpts = (s: JobStats, until = deadline()) => ({
  deadline: until,
  onPage: () => (s.pages += 1),
  onTruncate: () => (s.truncated = true),
});

/** Grouped profile lookup: one query per 200 ids instead of one per row. */
async function profilesById(ids: string[]) {
  const map = new Map<string, { preferred_language: string | null; full_name: string | null }>();
  for (const part of chunk([...new Set(ids)], 200)) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, preferred_language, full_name")
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) map.set(p.id, p);
  }
  return map;
}

/**
 * Repairs open cases that never completed intake: no responsible officer, or no
 * SLA deadlines. Both make a case invisible to the SLA sweep and to owner queues.
 */
async function caseHygiene(): Promise<JobResult> {
  const s = makeJobStats();
  const until = deadline();
  s.details = { routed: 0, slaApplied: 0 };
  const { routeCase } = await import("./routing.server");
  const { applySlaToCase } = await import("./sla.server");
  for await (const page of pagedRows(
    (after, size) => {
      let q = supabaseAdmin
        .from("cases")
        .select("id, assigned_to, first_response_due_at, resolution_due_at")
        .eq("is_demo", false)
        .not("status", "in", "(closed,resolved,withdrawn,rejected,duplicate)")
        .or("assigned_to.is.null,first_response_due_at.is.null,resolution_due_at.is.null")
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q;
    },
    pageOpts(s, until),
  )) {
    for (const c of page) {
      if (outOfTime(s, until)) break;
      s.processed += 1;
      try {
        if (!c.assigned_to) {
          const result = await routeCase(c.id);
          if (result.assigneeId) bump(s, "routed", 1);
          bump(s, "slaApplied", 1); // routeCase applies the SLA itself
          continue;
        }
        if (await applySlaToCase(c.id)) bump(s, "slaApplied", 1);
      } catch {
        s.errors += 1;
      }
    }
  }
  return statsResult(s);
}

/** Escalate cases that breached their resolution deadline, oldest breach first. */
async function autoEscalation(): Promise<JobResult> {
  const s = makeJobStats();
  const until = deadline();
  s.details = { escalated: 0 };
  const nowIso = new Date().toISOString();
  for await (const page of pagedRows(
    (after, size) => {
      let q = supabaseAdmin
        .from("cases")
        .select("id, escalation_level")
        .eq("is_demo", false)
        // Already-escalated cases wait for the escalation owner; re-escalating
        // them every run would climb to level 3 for the same breach.
        .not("status", "in", "(closed,resolved,escalated,withdrawn,rejected,duplicate)")
        .is("sla_paused_at", null)
        .lt("resolution_due_at", nowIso)
        // level cap in the query, so capped cases never consume batch slots
        .or("escalation_level.is.null,escalation_level.lt.3")
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q;
    },
    pageOpts(s, until),
  )) {
    for (const c of page) {
      if (outOfTime(s, until)) break;
      s.processed += 1;
      try {
        const ok = await escalateCase({ caseId: c.id, reason: "Resolution deadline breached", triggerType: "sla_breach" });
        if (ok) bump(s, "escalated", 1);
        else s.skipped += 1;
      } catch {
        s.errors += 1;
      }
    }
  }
  return statsResult(s);
}

/** Remind students about open information requests, and expire those long past due. */
async function infoRequestReminders(): Promise<JobResult> {
  const s = makeJobStats();
  s.details = { reminded: 0, expired: 0 };
  const now = Date.now();
  for await (const page of pagedRows(
    (after, size) => {
      let q = supabaseAdmin
        .from("case_information_requests")
        .select("id, case_id, due_at, reminder_days")
        .eq("status", "pending")
        .not("due_at", "is", null)
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q;
    },
    pageOpts(s),
  )) {
    const caseIds = [...new Set(page.map((r) => r.case_id))];
    const cases = new Map<string, { id: string; case_number: string; student_id: string; language: string | null }>();
    for (const part of chunk(caseIds, 200)) {
      const { data, error } = await supabaseAdmin
        .from("cases")
        .select("id, case_number, student_id, language")
        .in("id", part)
        .eq("is_demo", false);
      if (error) throw new Error(error.message);
      for (const c of data ?? []) cases.set(c.id, c);
    }
    const toExpire: string[] = [];
    for (const r of page) {
      s.processed += 1;
      const c = cases.get(r.case_id);
      if (!c) {
        s.skipped += 1;
        continue;
      }
      const step = infoRequestAction(r.due_at, r.reminder_days, now);
      if (step.action === "expire") {
        toExpire.push(r.id);
        continue;
      }
      if (step.action === "skip") {
        s.skipped += 1;
        continue;
      }
      const ok = await emitNotification({
        eventType: "information_requested",
        entityType: "case",
        entityId: c.id,
        recipientId: c.student_id,
        language: (c.language as "en" | "ar") ?? "en",
        vars: { case_number: c.case_number, days: step.daysLeft },
        actionUrl: `/requests/${c.id}`,
        dedupeKey: `inforeq:${r.id}:d${step.daysLeft}`,
      });
      if (ok) bump(s, "reminded", 1);
      else s.errors += 1;
    }
    for (const part of chunk(toExpire, 200)) {
      const { error } = await supabaseAdmin.from("case_information_requests").update({ status: "expired" }).in("id", part);
      if (error) s.errors += part.length;
      else bump(s, "expired", part.length);
    }
  }
  return statsResult(s);
}

/** Invite students to rate cases closed in the last 14 days that have no feedback yet. */
async function satisfactionSurveys(): Promise<JobResult> {
  const s = makeJobStats();
  s.details = { sent: 0 };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  for await (const page of pagedRows(
    (after, size) => {
      let q = supabaseAdmin
        .from("cases")
        .select("id, case_number, student_id, language")
        .eq("is_demo", false)
        .eq("status", "closed")
        .gte("closed_at", since)
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q;
    },
    pageOpts(s),
  )) {
    const rated = new Set<string>();
    for (const part of chunk(page.map((c) => c.id), 200)) {
      const { data, error } = await supabaseAdmin.from("case_feedback").select("case_id").in("case_id", part);
      if (error) throw new Error(error.message);
      for (const f of data ?? []) rated.add(f.case_id);
    }
    for (const c of page) {
      s.processed += 1;
      if (rated.has(c.id)) {
        s.skipped += 1;
        continue;
      }
      const ok = await emitNotification({
        eventType: "satisfaction_survey",
        entityType: "case",
        entityId: c.id,
        recipientId: c.student_id,
        language: (c.language as "en" | "ar") ?? "en",
        vars: { case_number: c.case_number },
        actionUrl: `/requests/${c.id}`,
        dedupeKey: `survey:${c.id}`,
      });
      if (ok) bump(s, "sent", 1);
      else s.errors += 1;
    }
  }
  return statsResult(s);
}

/** Notify students when a service they asked about has opened (earliest first). */
async function serviceOpenReminders(): Promise<JobResult> {
  const s = makeJobStats();
  s.details = { sent: 0 };
  const nowIso = new Date().toISOString();
  for await (const page of pagedRows(
    (after, size) => {
      let q = supabaseAdmin
        .from("student_service_reminders")
        .select("id, student_id, service_id, university_services(code, name_en, name_ar)")
        .eq("status", "scheduled")
        .lte("scheduled_for", nowIso)
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q;
    },
    pageOpts(s),
  )) {
    const profiles = await profilesById(page.map((r) => r.student_id));
    const done: string[] = [];
    for (const r of page) {
      s.processed += 1;
      const svc = (r as unknown as { university_services?: { code: string; name_en: string; name_ar: string } | null })
        .university_services;
      const lang = (profiles.get(r.student_id)?.preferred_language as "en" | "ar") ?? "en";
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
      done.push(r.id);
      if (ok) bump(s, "sent", 1);
      else s.errors += 1;
    }
    for (const part of chunk(done, 200)) {
      await supabaseAdmin
        .from("student_service_reminders")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", part);
    }
  }
  return statsResult(s);
}

const REMINDER_WINDOW_HOURS = 26;

/**
 * Reminds students and staff about appointments starting in the next ~24 hours.
 * Selects slots by start time first, so only time-relevant appointments are
 * read and none are starved by older or far-future rows. Dedupe keys make
 * repeated runs harmless.
 */
async function appointmentReminders(): Promise<JobResult> {
  const s = makeJobStats();
  s.details = { sent: 0, staffSent: 0 };
  const now = Date.now();
  const from = new Date(now).toISOString();
  const to = new Date(now + REMINDER_WINDOW_HOURS * 3600_000).toISOString();

  type Slot = {
    id: string;
    start_time: string;
    location: string | null;
    meeting_link: string | null;
    staff_profile_id: string | null;
    appointment_types: {
      service_unit_id: string | null;
      service_units: { name_en: string; name_ar: string } | null;
    } | null;
  };

  for await (const slotPage of pagedRows<Slot>(
    (after, size) => {
      let q = supabaseAdmin
        .from("appointment_slots")
        .select(
          "id, start_time, location, meeting_link, staff_profile_id, appointment_types:appointment_type_id (service_unit_id, service_units:service_unit_id (name_en, name_ar))",
        )
        .gte("start_time", from)
        .lte("start_time", to)
        .order("id")
        .limit(size);
      if (after) q = q.gt("id", after);
      return q as unknown as PromiseLike<{ data: Slot[] | null; error: { message: string } | null }>;
    },
    pageOpts(s),
  )) {
    const slots = new Map(slotPage.map((sl) => [sl.id, sl]));
    const appts: { id: string; student_id: string; appointment_slot_id: string }[] = [];
    for (const part of chunk([...slots.keys()], 200)) {
      const { data, error } = await supabaseAdmin
        .from("student_appointments")
        .select("id, student_id, appointment_slot_id")
        .in("appointment_slot_id", part)
        .in("status", ["booked", "confirmed", "pending_approval"]);
      if (error) throw new Error(error.message);
      appts.push(...((data ?? []) as typeof appts));
    }
    const profiles = await profilesById(appts.map((a) => a.student_id));
    for (const a of appts) {
      s.processed += 1;
      const slot = slots.get(a.appointment_slot_id);
      if (!slot || !inReminderWindow(slot.start_time, now, REMINDER_WINDOW_HOURS)) {
        s.skipped += 1;
        continue;
      }
      const profile = profiles.get(a.student_id);
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
      if (ok) bump(s, "sent", 1);
      else s.errors += 1;
      if (slot.staff_profile_id) {
        const staffOk = await emitNotification({
          eventType: "appointment_reminder",
          entityType: "student_appointment",
          entityId: a.id,
          recipientId: slot.staff_profile_id,
          language: "en",
          vars: { ...vars, staff_name: profile?.full_name ?? "" },
          actionUrl: "/cases",
          serviceUnitId: slot.appointment_types?.service_unit_id ?? null,
          dedupeKey: `appointment-reminder:${a.id}:staff`,
        });
        if (staffOk) bump(s, "staffSent", 1);
      }
    }
  }
  return statsResult(s);
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
