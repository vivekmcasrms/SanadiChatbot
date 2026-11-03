/** Server functions for the agentic automation layer and the Service Owner console. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ATTENTION_ORDER = [
  "sensitive",
  "sla_critical",
  "approval_required",
  "decision_required",
  "escalation_review",
  "resolution_approval",
  "student_disputed",
  "policy_conflict",
  "low_confidence",
  "unable_to_automate",
];

/** Everything the Service Owner landing page needs: exceptions first, AI work second. */
export const getOwnerConsoleFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;

    const { data: cases } = await db
      .from("cases")
      .select(
        "id, case_number, case_type, title, status, urgency, language, is_sensitive, ai_confidence, service_unit_id, assigned_to, resolution_due_at, first_response_due_at, created_at, last_activity_at",
      )
      .not("status", "in", "(closed,resolved,withdrawn,rejected,duplicate)")
      .order("created_at", { ascending: false })
      .limit(300);

    const ids = (cases ?? []).map((c) => c.id);
    const { data: states } = ids.length
      ? await db
          .from("case_automation_state")
          .select(
            "case_id, ai_status, attention_category, attention_reason_en, attention_reason_ar, next_action_key, next_action_en, next_action_ar, next_action_at, automation_paused, pause_reason, reminders_sent, last_automated_at, ai_confidence",
          )
          .in("case_id", ids)
      : { data: [] };

    const stateFor = new Map((states ?? []).map((s) => [s.case_id, s]));
    const rows = (cases ?? []).map((c) => ({ ...c, automation: stateFor.get(c.id) ?? null }));

    const attention = rows
      .filter((r) => r.automation?.attention_category || r.automation?.automation_paused)
      .sort((a, b) => {
        const ai = ATTENTION_ORDER.indexOf(a.automation?.attention_category ?? "");
        const bi = ATTENTION_ORDER.indexOf(b.automation?.attention_category ?? "");
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
    const managed = rows.filter((r) => r.automation && !r.automation.attention_category && !r.automation.automation_paused);
    const unmanaged = rows.filter((r) => !r.automation);

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data: events }, { data: edits }, { data: prefs }] = await Promise.all([
      db
        .from("automation_events")
        .select("action_key, actor_type, executed, human_review_required, autonomy_level, created_at")
        .gte("created_at", since)
        .limit(2000),
      db.from("ai_human_edits").select("edit_category, created_at").gte("created_at", since).limit(500),
      db
        .from("service_owner_ai_preferences")
        .select("*")
        .eq("staff_profile_id", context.userId)
        .maybeSingle(),
    ]);

    const total = events?.length ?? 0;
    const aiExecuted = (events ?? []).filter((e) => e.actor_type === "ai" && e.executed).length;
    const humanTouches = (events ?? []).filter((e) => e.actor_type === "human").length;
    const editCounts = (edits ?? []).reduce<Record<string, number>>((acc, e) => {
      acc[e.edit_category] = (acc[e.edit_category] ?? 0) + 1;
      return acc;
    }, {});

    // Compact impact signal for the autonomous services this owner supervises:
    // how much bureaucracy the AI removed, expressed in student hours.
    const { data: baselines } = await db
      .from("service_impact_baselines")
      .select("service_unit_id, before_processing_hours, after_processing_hours");
    const avgSaved =
      (baselines ?? []).length > 0
        ? (baselines ?? []).reduce((n, b) => n + Math.max(0, Number(b.before_processing_hours ?? 0) - Number(b.after_processing_hours ?? 0)), 0) /
          (baselines ?? []).length
        : 0;
    const autonomousCompletions = aiExecuted;

    return {
      attention,
      managed,
      unmanaged,
      preferences: prefs ?? null,
      impact: {
        autonomousCompletions,
        hoursSaved: Math.round(autonomousCompletions * avgSaved),
        aiActions: aiExecuted,
      },
      metrics: {
        // Never a percentage from an empty (or statistically meaningless)
        // denominator: the UI shows "Insufficient data" when this is null.
        automationRate: total >= 5 ? Math.round((aiExecuted / total) * 100) : null,
        sampleSize: total,
        aiActions: aiExecuted,
        humanActions: humanTouches,
        attentionCount: attention.length,
        managedCount: managed.length,
        editCounts,
        totalEdits: edits?.length ?? 0,
      },
    };
  });

/** Automation timeline for one case: what the AI did, when, and under which policy. */
export const getCaseAutomationFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const [{ data: state }, { data: events }] = await Promise.all([
      db.from("case_automation_state").select("*").eq("case_id", data.caseId).maybeSingle(),
      db
        .from("automation_events")
        .select("id, action_key, actor_type, autonomy_level, rule_used, summary_en, summary_ar, executed, human_review_required, created_at")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return { state: state ?? null, events: events ?? [] };
  });

export const runCaseIntakeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { intakeCase } = await import("./automation/case-manager.server");
    return intakeCase(data.caseId);
  });

export const setAutomationPauseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ caseId: z.string().uuid(), pause: z.boolean(), reason: z.string().max(500).default("") })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    const { pauseAutomation } = await import("./automation/case-manager.server");
    return pauseAutomation(data.caseId, context.userId, data.reason, data.pause);
  });

export const overrideAutomationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        field: z.enum(["unit", "urgency", "assignee", "classification"]),
        value: z.string().min(1),
        reason: z.string().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    const { overrideCaseDecision } = await import("./automation/case-manager.server");
    return overrideCaseDecision({ ...data, actorId: context.userId });
  });

export const prepareDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    const { prepareDraftResponse } = await import("./automation/drafts.server");
    return prepareDraftResponse(data.caseId, context.userId);
  });

export const sendDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        originalDraft: z.string().max(8000),
        finalText: z.string().min(1).max(8000),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    const { sendDraftResponse } = await import("./automation/drafts.server");
    return sendDraftResponse({ ...data, actorId: context.userId });
  });

export const saveOwnerPreferencesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        auto_send_routine_updates: z.boolean(),
        auto_request_missing_information: z.boolean(),
        auto_follow_up: z.boolean(),
        auto_escalate_by_policy: z.boolean(),
        auto_prepare_resolution: z.boolean(),
        auto_close_eligible_cases: z.boolean(),
        require_review_for_all_student_messages: z.boolean(),
        preferred_response_style: z.enum(["concise_formal", "warm_supportive", "detailed_procedural"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("service_owner_ai_preferences")
      .upsert({ staff_profile_id: context.userId, ...data }, { onConflict: "staff_profile_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Global autonomy configuration (managers only, enforced by RLS on the table). */
export const getAutomationPoliciesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: policies }, { data: followUps }] = await Promise.all([
      context.supabase
        .from("automation_policies")
        .select("id, action_key, case_type, risk_level, applies_to_sensitive, autonomy_level, min_confidence, is_active")
        .order("action_key"),
      context.supabase
        .from("follow_up_policies")
        .select("id, waiting_state, first_reminder_after_hours, second_reminder_after_hours, final_reminder_after_hours, escalation_after_hours, maximum_reminders, is_active")
        .order("waiting_state"),
    ]);
    return { policies: policies ?? [], followUps: followUps ?? [] };
  });

export const setPolicyAutonomyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        autonomyLevel: z.enum(["automatic", "automatic_notify", "owner_approval", "human_only"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("automation_policies")
      .update({ autonomy_level: data.autonomyLevel })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
/** Follow-up and SLA workload for the caller's own service unit (RLS-scoped). */
export const getOwnerOperationsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadOwnerOperations } = await import("./ops/owner-operations.server");
    return loadOwnerOperations(context.supabase);
  });

/**
 * Lets service staff flag incorrect or missing policy knowledge for the
 * Knowledge team without granting them knowledge administration rights.
 */
export const reportKnowledgeIssueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        issueType: z.enum(["incorrect_information", "missing_information", "outdated_policy", "suggested_update"]),
        description: z.string().trim().min(10).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("knowledge_issue_reports").insert({
      source_type: "service_owner_report",
      reported_by: context.userId,
      issue_type: data.issueType,
      description: data.description,
      priority: "normal",
      status: "open",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
