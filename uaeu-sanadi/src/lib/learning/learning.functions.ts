import { getActiveRoles } from "@/lib/authz/roles.server";
/**
 * Learning Center API. Everything here is read-and-decide: nothing activates
 * without an explicit human decision, and approvals are limited to the safe
 * areas (routing, wording, clarification, knowledge gaps, tool hints).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FEEDBACK_REASONS, type CorrectionType } from "./types";

const REVIEW_ROLES = ["system_admin", "service_manager", "knowledge_manager"];
const READ_ROLES = [...REVIEW_ROLES, "auditor", "service_owner"];

async function rolesOf(db: { from: (t: string) => any }, userId: string): Promise<string[]> {
  return getActiveRoles(db, userId);
}

async function assertReader(db: any, userId: string) {
  const roles = await rolesOf(db, userId);
  if (!roles.some((r) => READ_ROLES.includes(r))) throw new Error("Not permitted");
  return roles;
}

async function assertReviewer(db: any, userId: string) {
  const roles = await rolesOf(db, userId);
  if (!roles.some((r) => REVIEW_ROLES.includes(r))) throw new Error("Not permitted");
  return roles;
}

/** Sections 1–4 of the Learning Center in one read. */
export const getLearningCenterFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const roles = await assertReader(db, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [signals, candidates, rules, units] = await Promise.all([
      supabaseAdmin
        .from("learning_signals")
        .select(
          "id, created_at, correction_type, correction_source, original_domain, corrected_domain, original_unit_id, corrected_unit_id, original_user_text, staff_comment, student_feedback, reason_code, policy_sensitive, status, confidence",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("learning_candidates")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("learned_routing_rules")
        .select(
          "id, rule_name, trigger_phrases, pending_domain, target_domain, target_unit_id, priority, confidence, active, effective_from, applied_count, source_candidate_id",
        )
        .order("priority", { ascending: true }),
      supabaseAdmin.from("service_units").select("id, name_en, name_ar").eq("is_active", true),
    ]);

    const all = candidates.data ?? [];
    const impact = (all.filter((c) => c.status === "ACTIVE") as Record<string, any>[]).map((c) => ({
      id: c["id"] as string,
      title: c["title"] as string,
      activatedAt: c["activated_at"] as string | null,
      before: (c["baseline_metrics"]?.corrections_in_window as number) ?? c["evidence_count"],
      after: (c["impact_metrics"]?.corrections_since as number) ?? null,
      applied:
        (rules.data ?? []).find((r) => r.source_candidate_id === c["id"])?.applied_count ?? null,
    }));

    return {
      canReview: roles.some((r) => REVIEW_ROLES.includes(r)),
      signals: signals.data ?? [],
      candidates: all,
      rules: rules.data ?? [],
      units: units.data ?? [],
      impact,
    };
  });

/** Approve, edit-and-approve, reject or defer a proposal. */
export const decideLearningCandidateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        candidateId: z.string().uuid(),
        decision: z.enum(["APPROVE", "REJECT", "DEFER"]),
        note: z.string().max(1000).optional(),
        edits: z
          .object({
            title: z.string().min(4).max(200).optional(),
            triggerPhrases: z.array(z.string().min(2).max(60)).max(12).optional(),
            targetUnitId: z.string().uuid().nullable().optional(),
            targetDomain: z.string().max(40).nullable().optional(),
            priority: z.number().int().min(1).max(999).optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: candidate } = await supabaseAdmin
      .from("learning_candidates")
      .select("*")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (!candidate) throw new Error("Proposal not found");
    if (["APPROVED", "ACTIVE", "REJECTED"].includes(candidate.status as string)) {
      return { ok: true, alreadyDecided: true };
    }

    const now = new Date().toISOString();
    if (data.decision === "REJECT" || data.decision === "DEFER") {
      await supabaseAdmin
        .from("learning_candidates")
        .update({
          status: data.decision === "REJECT" ? "REJECTED" : "DEFERRED",
          review_note: data.note ?? null,
          approved_by: context.userId,
          approved_at: now,
        })
        .eq("id", data.candidateId);
      return { ok: true, activated: false };
    }

    const change = (candidate.proposed_change ?? {}) as Record<string, any>;
    let activated = false;

    if (change["kind"] === "routing_rule") {
      const phrases = data.edits?.triggerPhrases ?? (change["trigger_phrases"] as string[]) ?? [];
      if (!phrases.length) throw new Error("A routing rule needs at least one trigger phrase");
      await supabaseAdmin.from("learned_routing_rules").insert({
        rule_name: data.edits?.title ?? (change["rule_name"] as string) ?? (candidate.title as string),
        trigger_context: (candidate.pattern_key as string) ?? null,
        trigger_phrases: phrases,
        pending_domain: (change["pending_domain"] as string | null) ?? null,
        target_domain:
          data.edits?.targetDomain !== undefined
            ? data.edits.targetDomain
            : ((change["target_domain"] as string | null) ?? null),
        target_service: (change["target_service"] as string | null) ?? null,
        target_unit_id:
          data.edits?.targetUnitId !== undefined
            ? data.edits.targetUnitId
            : ((change["target_unit_id"] as string | null) ?? null),
        priority: data.edits?.priority ?? (change["priority"] as number) ?? 100,
        confidence: candidate.confidence,
        approved_by: context.userId,
        source_candidate_id: candidate.id,
        active: true,
      });
      activated = true;
    }

    await supabaseAdmin
      .from("learning_candidates")
      .update({
        status: "ACTIVE",
        title: data.edits?.title ?? candidate.title,
        review_note: data.note ?? null,
        approved_by: context.userId,
        approved_at: now,
        activated_at: now,
      })
      .eq("id", data.candidateId);

    return { ok: true, activated };
  });

/** Turn an active learned rule on or off without deleting the audit trail. */
export const toggleLearnedRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ruleId: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("learned_routing_rules").update({ active: data.active }).eq("id", data.ruleId);
    return { ok: true };
  });

/** Re-run pattern detection on demand. */
export const runLearningDetectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { detectLearningCandidates } = await import("./detect.server");
    return detectLearningCandidates({});
  });

/** Student feedback on an assistant answer: optional reason, optional free text. */
export const submitAssistantFeedbackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid().nullable().optional(),
        messageId: z.string().uuid().nullable().optional(),
        helpful: z.boolean(),
        reasonCode: z.string().max(40).optional(),
        comment: z.string().max(1000).optional(),
        domain: z.string().max(40).nullable().optional(),
        userText: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.helpful) return { ok: true, recorded: false };
    const reason = FEEDBACK_REASONS.find((r) => r.code === data.reasonCode);
    const { recordLearningSignal } = await import("./signals.server");
    await recordLearningSignal({
      correctionType: (reason?.correction ?? "RESPONSE_QUALITY") as CorrectionType,
      source: "STUDENT",
      conversationId: data.conversationId ?? null,
      messageId: data.messageId ?? null,
      studentId: context.userId,
      originalDomain: data.domain ?? null,
      originalUserText: data.userText ?? null,
      studentFeedback: data.comment ?? null,
      reasonCode: data.reasonCode ?? null,
      confidence: 0.55,
    });
    return { ok: true, recorded: true };
  });

/* ------------------------------------------------------------------ */
/* Adaptive routing improvements                                       */
/* ------------------------------------------------------------------ */

/** Everything the "Routing Improvements" section needs in one read. */
export const getRoutingImprovementsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await assertReader(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { routingImprovementMetrics } = await import("./routing-candidates.server");
    const { loadLearningConfig } = await import("./rules.server");

    const [rules, decisions, units, config, metrics] = await Promise.all([
      supabaseAdmin
        .from("learned_routing_rules")
        .select("*")
        .order("status", { ascending: true })
        .order("priority", { ascending: true })
        .limit(300),
      supabaseAdmin
        .from("learned_rule_decisions")
        .select(
          "id, created_at, rule_id, mode, matched_phrase, matched_context, language, previous_target, selected_target, shadow_prediction, actual_target, confidence, evidence_count, activation_mode, outcome, outcome_reason",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin.from("service_units").select("id, name_en, name_ar").eq("is_active", true),
      loadLearningConfig(),
      routingImprovementMetrics(),
    ]);

    return {
      canReview: roles.some((r) => REVIEW_ROLES.includes(r)),
      rules: rules.data ?? [],
      decisions: decisions.data ?? [],
      units: units.data ?? [],
      config,
      metrics,
    };
  });

/** Activate, approve, pause, roll back, edit or reject one learned routing rule. */
export const decideRoutingRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ruleId: z.string().uuid(),
        action: z.enum(["ACTIVATE", "APPROVE", "SHADOW", "PAUSE", "ROLLBACK", "REJECT", "EDIT"]),
        reason: z.string().max(1000).optional(),
        edits: z
          .object({
            ruleName: z.string().min(4).max(200).optional(),
            triggerPhrases: z.array(z.string().min(2).max(80)).max(20).optional(),
            targetDomain: z.string().max(40).nullable().optional(),
            targetUnitId: z.string().uuid().nullable().optional(),
            priority: z.number().int().min(1).max(999).optional(),
            sourceLanguage: z.enum(["en", "ar", "both"]).optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { invalidateRoutingRuleCache } = await import("./rules.server");

    const { data: rule } = await supabaseAdmin
      .from("learned_routing_rules")
      .select("id, risk_level, status")
      .eq("id", data.ruleId)
      .maybeSingle();
    if (!rule) throw new Error("Rule not found");

    const now = new Date().toISOString();
    const edits = data.edits ?? {};
    const patch: Record<string, unknown> = {
      ...(edits.ruleName ? { rule_name: edits.ruleName } : {}),
      ...(edits.triggerPhrases ? { trigger_phrases: edits.triggerPhrases } : {}),
      ...(edits.targetDomain !== undefined ? { target_domain: edits.targetDomain } : {}),
      ...(edits.targetUnitId !== undefined ? { target_unit_id: edits.targetUnitId } : {}),
      ...(edits.priority !== undefined ? { priority: edits.priority } : {}),
      ...(edits.sourceLanguage ? { source_language: edits.sourceLanguage } : {}),
    };

    switch (data.action) {
      case "EDIT":
        break;
      case "SHADOW":
        Object.assign(patch, { status: "SHADOW", active: false });
        break;
      case "APPROVE":
        Object.assign(patch, {
          status: "APPROVED",
          active: false,
          approved_by: context.userId,
          approved_at: now,
        });
        break;
      case "ACTIVATE":
        Object.assign(patch, {
          status: "ACTIVE",
          active: true,
          approved_by: context.userId,
          approved_at: now,
          effective_from: now,
          rollback_reason: null,
          paused_at: null,
        });
        break;
      case "PAUSE":
        Object.assign(patch, {
          status: "PAUSED",
          active: false,
          paused_at: now,
          rollback_reason: data.reason ?? "Paused by an administrator",
        });
        break;
      case "ROLLBACK":
        Object.assign(patch, {
          status: "ROLLED_BACK",
          active: false,
          paused_at: now,
          rollback_reason: data.reason ?? "Rolled back by an administrator",
        });
        break;
      case "REJECT":
        Object.assign(patch, {
          status: "REJECTED",
          active: false,
          rollback_reason: data.reason ?? "Rejected by an administrator",
        });
        break;
    }

    await supabaseAdmin
      .from("learned_routing_rules")
      .update(patch as Record<string, never>)
      .eq("id", data.ruleId);
    await invalidateRoutingRuleCache(context.supabase as never);
    return { ok: true, status: patch["status"] ?? rule.status };
  });

/** Run candidate generation + historical replay on demand. */
export const runRoutingLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { buildRoutingCandidates, evaluateLearnedRules } = await import("./routing-candidates.server");
    const built = await buildRoutingCandidates({});
    const evaluated = await evaluateLearnedRules();
    return { built, evaluated };
  });

/** Adjust the evidence thresholds and safety limits. */
export const updateLearningConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        thresholdLow: z.number().int().min(2).max(50).optional(),
        thresholdNormal: z.number().int().min(2).max(100).optional(),
        thresholdHigh: z.number().int().min(3).max(200).optional(),
        minHistoricalAccuracy: z.number().min(0.5).max(1).optional(),
        minShadowSamples: z.number().int().min(1).max(200).optional(),
        minShadowAccuracy: z.number().min(0.5).max(1).optional(),
        autoActivationEnabled: z.boolean().optional(),
        pauseConfidence: z.number().min(0.1).max(0.95).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReviewer(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = {
      ...(data.thresholdLow !== undefined ? { threshold_low: data.thresholdLow } : {}),
      ...(data.thresholdNormal !== undefined ? { threshold_normal: data.thresholdNormal } : {}),
      ...(data.thresholdHigh !== undefined ? { threshold_high: data.thresholdHigh } : {}),
      ...(data.minHistoricalAccuracy !== undefined
        ? { min_historical_accuracy: data.minHistoricalAccuracy }
        : {}),
      ...(data.minShadowSamples !== undefined ? { min_shadow_samples: data.minShadowSamples } : {}),
      ...(data.minShadowAccuracy !== undefined ? { min_shadow_accuracy: data.minShadowAccuracy } : {}),
      ...(data.autoActivationEnabled !== undefined
        ? { auto_activation_enabled: data.autoActivationEnabled }
        : {}),
      ...(data.pauseConfidence !== undefined ? { pause_confidence: data.pauseConfidence } : {}),
      updated_by: context.userId,
    };
    const { data: row } = await supabaseAdmin
      .from("learning_config")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (row?.id) await supabaseAdmin.from("learning_config").update(patch).eq("id", row.id);
    else await supabaseAdmin.from("learning_config").insert(patch);
    return { ok: true };
  });
