/**
 * Approved-rules layer at runtime.
 *
 * Routing order (highest authority first):
 *   1. pending transactional state
 *   2. explicit current request
 *   3. high-confidence approved learned rule
 *   4. deterministic service/routing rule
 *   5. strong conversation context
 *   6. classifier
 *   7. clarification
 *
 * A learned rule can only refine an unclear turn. It never overrides an
 * explicit request, and it never decides eligibility, permission or policy.
 * Rules in SHADOW status predict only: their prediction is logged and compared,
 * production routing is untouched.
 */
import { getCached } from "../quality/cache.server";
import type { Db } from "../agent/tools.server";
import {
  DEFAULT_LEARNING_CONFIG,
  matchRoutingRules,
  shouldPauseRule,
  type LearningConfig,
  type RoutingContext,
  type RoutingRule,
  type RuleMatch,
} from "./routing-improvement";

/** Back-compatible shape used by the original routing hook. */
export type LearnedRule = {
  id: string;
  rule_name: string;
  trigger_context: string | null;
  trigger_phrases: string[];
  pending_domain: string | null;
  target_domain: string | null;
  target_service: string | null;
  target_unit_id: string | null;
  priority: number;
  confidence: number;
};

const RULE_COLUMNS =
  "id, rule_name, description, rule_type, trigger_context, trigger_phrases, trigger_patterns, required_context, excluded_context, source_language, pending_domain, target_domain, target_intent, target_service, target_service_id, target_unit_id, priority, confidence, evidence_count, historical_accuracy, shadow_accuracy, shadow_samples, risk_level, status, activation_mode, success_count, failure_count";

export async function loadLearningConfig(db?: Db): Promise<LearningConfig> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("learning_config").select("*").limit(1).maybeSingle();
    if (!data) return DEFAULT_LEARNING_CONFIG;
    return {
      threshold_low: Number(data.threshold_low ?? DEFAULT_LEARNING_CONFIG.threshold_low),
      threshold_normal: Number(data.threshold_normal ?? DEFAULT_LEARNING_CONFIG.threshold_normal),
      threshold_high: Number(data.threshold_high ?? DEFAULT_LEARNING_CONFIG.threshold_high),
      min_historical_accuracy: Number(
        data.min_historical_accuracy ?? DEFAULT_LEARNING_CONFIG.min_historical_accuracy,
      ),
      min_shadow_samples: Number(data.min_shadow_samples ?? DEFAULT_LEARNING_CONFIG.min_shadow_samples),
      min_shadow_accuracy: Number(data.min_shadow_accuracy ?? DEFAULT_LEARNING_CONFIG.min_shadow_accuracy),
      auto_activation_enabled: Boolean(
        data.auto_activation_enabled ?? DEFAULT_LEARNING_CONFIG.auto_activation_enabled,
      ),
      pause_confidence: Number(data.pause_confidence ?? DEFAULT_LEARNING_CONFIG.pause_confidence),
      pause_failure_streak: Number(
        data.pause_failure_streak ?? DEFAULT_LEARNING_CONFIG.pause_failure_streak,
      ),
    };
  } catch {
    return DEFAULT_LEARNING_CONFIG;
  }
  void db;
}

/** Live rules only (status ACTIVE). Cached briefly so routing stays cheap. */
export async function loadLearnedRoutingRules(db: Db): Promise<LearnedRule[]> {
  return getCached(db, {
    key: "learned_routing_rules:v1",
    category: "learned_routing",
    ttlSeconds: 120,
    load: async () => {
      const { data } = await db
        .from("learned_routing_rules")
        .select(
          "id, rule_name, trigger_context, trigger_phrases, pending_domain, target_domain, target_service, target_unit_id, priority, confidence",
        )
        .eq("active", true)
        .lte("effective_from", new Date().toISOString())
        .order("priority", { ascending: true });
      return (data ?? []) as LearnedRule[];
    },
  });
}

/** Active + shadow rules with their full context definition. */
export async function loadRoutingRules(
  db: Db,
): Promise<{ active: RoutingRule[]; shadow: RoutingRule[] }> {
  const rows = await getCached(db, {
    key: "learned_routing_rules:v2",
    category: "learned_routing",
    ttlSeconds: 120,
    load: async () => {
      // Read with the service client: approved rules are governance data that
      // students may never read directly, but they must still steer routing
      // for every user. Only routing metadata is used, never returned to them.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("learned_routing_rules")
        .select(RULE_COLUMNS)
        .in("status", ["ACTIVE", "SHADOW"])
        .lte("effective_from", new Date().toISOString())
        .order("priority", { ascending: true });
      return (data ?? []) as unknown as RoutingRule[];
    },
  });
  const all = (rows ?? []) as RoutingRule[];
  return {
    active: all.filter((r) => r.status === "ACTIVE"),
    shadow: all.filter((r) => r.status === "SHADOW"),
  };
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Original simple matcher, kept for the phrase-only rules created before the
 * context-aware layer existed.
 */
export function matchLearnedRule(
  rules: LearnedRule[],
  opts: { message: string; pendingDomain?: string | null; explicitDomains?: string[] },
): LearnedRule | null {
  const text = normalize(opts.message);
  if (!text) return null;
  const explicit = new Set(opts.explicitDomains ?? []);

  const matches = rules.filter((rule) => {
    if (rule.pending_domain && rule.pending_domain !== (opts.pendingDomain ?? null)) return false;
    const phrases = (rule.trigger_phrases ?? []).map(normalize).filter(Boolean);
    if (!phrases.length) return false;
    if (!phrases.some((p) => text.includes(p))) return false;
    if (rule.target_domain && explicit.size && !explicit.has(rule.target_domain)) return false;
    return true;
  });

  if (!matches.length) return null;
  return matches.sort((a, b) => a.priority - b.priority || b.confidence - a.confidence)[0] ?? null;
}

export type RoutingRuleOutcome = {
  applied: RuleMatch | null;
  shadow: RuleMatch | null;
};

/**
 * Evaluates the learned layer for one turn: returns the live rule to apply (if
 * any) and logs both the live decision and every shadow prediction.
 */
export async function evaluateLearnedRouting(
  db: Db,
  ctx: RoutingContext,
  meta: { conversationId?: string | null; previousTarget?: string | null } = {},
): Promise<RoutingRuleOutcome> {
  let rules: { active: RoutingRule[]; shadow: RoutingRule[] };
  try {
    rules = await loadRoutingRules(db);
  } catch {
    return { applied: null, shadow: null };
  }
  const applied = rules.active.length ? matchRoutingRules(rules.active, ctx) : null;
  const shadow = rules.shadow.length ? matchRoutingRules(rules.shadow, ctx) : null;

  if (applied) {
    void logRuleDecision({
      rule: applied,
      ctx,
      mode: "ACTIVE",
      conversationId: meta.conversationId ?? null,
      previousTarget: meta.previousTarget ?? null,
    });
  }
  if (shadow) {
    void logRuleDecision({
      rule: shadow,
      ctx,
      mode: "SHADOW",
      conversationId: meta.conversationId ?? null,
      previousTarget: meta.previousTarget ?? null,
      actualTarget: applied?.rule.target_domain ?? meta.previousTarget ?? null,
    });
  }
  return { applied, shadow };
}

function ruleTarget(rule: RoutingRule): string | null {
  return rule.target_domain ?? rule.target_unit_id ?? rule.target_intent ?? null;
}

/** Explainability record — "why did Sanadi route this here?" without any chain-of-thought. */
export async function logRuleDecision(input: {
  rule: RuleMatch;
  ctx: RoutingContext;
  mode: "ACTIVE" | "SHADOW";
  conversationId?: string | null;
  caseId?: string | null;
  previousTarget?: string | null;
  actualTarget?: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rule = input.rule.rule;
    const target = ruleTarget(rule);
    const { data: inserted } = await supabaseAdmin.from("learned_rule_decisions").insert({
      rule_id: rule.id,
      conversation_id: input.conversationId ?? null,
      case_id: input.caseId ?? null,
      mode: input.mode,
      matched_phrase: input.rule.matchedPhrase,
      matched_context: {
        pending_domain: input.ctx.pendingDomain ?? null,
        pending_question: input.ctx.pendingQuestion ?? null,
        active_domain: input.ctx.activeDomain ?? null,
        explicit_domains: input.ctx.explicitDomains ?? [],
      },
      language: input.ctx.language ?? null,
      previous_target: input.previousTarget ?? null,
      selected_target: input.mode === "ACTIVE" ? target : null,
      shadow_prediction: input.mode === "SHADOW" ? target : null,
      actual_target: input.actualTarget ?? input.previousTarget ?? null,
      confidence: rule.confidence,
      evidence_count: rule.evidence_count ?? null,
      activation_mode: rule.activation_mode ?? null,
    }).select("id").maybeSingle();

    if (input.mode === "SHADOW") {
      const predicted = target;
      const actual = input.actualTarget ?? input.previousTarget ?? null;
      const samples = (rule.shadow_samples ?? 0) + 1;
      const previousCorrect = Math.round(Number(rule.shadow_accuracy ?? 0) * (rule.shadow_samples ?? 0));
      const correct = previousCorrect + (predicted && actual && predicted === actual ? 1 : 0);
      // Only this turn's own prediction is scored — a verdict must never be
      // stamped onto other pending shadow decisions for the same rule.
      if (inserted?.id) {
        await supabaseAdmin
          .from("learned_rule_decisions")
          .update({ outcome: predicted === actual ? "MATCHED" : "DIVERGED" })
          .eq("id", inserted.id);
      }
      await supabaseAdmin
        .from("learned_routing_rules")
        .update({
          shadow_samples: samples,
          shadow_accuracy: Number((correct / samples).toFixed(4)),
          last_evaluated_at: new Date().toISOString(),
        })
        .eq("id", rule.id);
    }
  } catch {
    /* observation only — logging never breaks a turn */
  }
}

/** Usage counter for the "learning impact" view. Best effort. */
export async function noteRuleApplied(ruleId: string, current: number) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("learned_routing_rules")
      .select("applied_count")
      .eq("id", ruleId)
      .maybeSingle();
    const next = Number(data?.applied_count ?? current) + 1;
    await supabaseAdmin.from("learned_routing_rules").update({ applied_count: next }).eq("id", ruleId);
  } catch {
    /* observation only */
  }
}

/**
 * A staff override or a student correction on a turn a learned rule steered.
 * Every failure recomputes confidence and can pause the rule on the spot.
 */
export async function noteRuleOutcome(input: {
  conversationId?: string | null;
  caseId?: string | null;
  ruleId?: string | null;
  success: boolean;
  reason?: string | null;
  correctedTarget?: string | null;
}): Promise<{ paused: boolean; ruleId: string | null }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let ruleId = input.ruleId ?? null;
    let decisionId: string | null = null;

    if (!ruleId && (input.conversationId || input.caseId)) {
      let q = supabaseAdmin
        .from("learned_rule_decisions")
        .select("id, rule_id")
        .eq("mode", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1);
      q = input.caseId ? q.eq("case_id", input.caseId) : q.eq("conversation_id", input.conversationId!);
      const { data } = await q.maybeSingle();
      ruleId = (data?.rule_id as string | null) ?? null;
      decisionId = (data?.id as string | null) ?? null;
    }
    if (!ruleId) return { paused: false, ruleId: null };

    if (decisionId) {
      await supabaseAdmin
        .from("learned_rule_decisions")
        .update({
          outcome: input.success ? "CONFIRMED" : "OVERRIDDEN",
          outcome_reason: input.reason ?? null,
          actual_target: input.correctedTarget ?? null,
        })
        .eq("id", decisionId);
    }

    const { data: rule } = await supabaseAdmin
      .from("learned_routing_rules")
      .select("id, rule_name, confidence, success_count, failure_count, status")
      .eq("id", ruleId)
      .maybeSingle();
    if (!rule) return { paused: false, ruleId };

    const success_count = Number(rule.success_count ?? 0) + (input.success ? 1 : 0);
    const failure_count = Number(rule.failure_count ?? 0) + (input.success ? 0 : 1);
    const config = await loadLearningConfig();
    const verdict = shouldPauseRule(
      { confidence: Number(rule.confidence ?? 0.5), success_count, failure_count },
      config,
    );
    const pause = verdict.pause && rule.status === "ACTIVE";

    await supabaseAdmin
      .from("learned_routing_rules")
      .update({
        success_count,
        failure_count,
        confidence: verdict.confidence,
        last_evaluated_at: new Date().toISOString(),
        ...(pause
          ? { status: "PAUSED", active: false, paused_at: new Date().toISOString(), rollback_reason: verdict.reason }
          : {}),
      })
      .eq("id", ruleId);

    if (pause) await notifyRulePaused(ruleId, String(rule.rule_name), verdict.reason ?? "");
    return { paused: pause, ruleId };
  } catch {
    return { paused: false, ruleId: null };
  }
}

async function notifyRulePaused(ruleId: string, ruleName: string, reason: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emitNotification } = await import("../ops/notify.server");
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["system_admin", "service_manager"]);
    for (const a of admins ?? []) {
      await emitNotification({
        eventType: "learning_rule_paused",
        entityType: "learned_routing_rule",
        entityId: ruleId,
        recipientId: a.user_id as string,
        language: "en",
        vars: { title: ruleName, reason },
        actionUrl: "/learning",
        dedupeKey: `learning-rule-paused:${ruleId}:${a.user_id}`,
      });
    }
  } catch {
    /* best effort */
  }
}

/** Clears the routing-rule cache after an activation, pause or rollback. */
export async function invalidateRoutingRuleCache(db: Db) {
  try {
    const { invalidateCache } = await import("../quality/cache.server");
    await invalidateCache(db, "learned_routing_rules", "learned routing rule changed");
  } catch {
    /* the cache expires on its own within two minutes */
  }
}
