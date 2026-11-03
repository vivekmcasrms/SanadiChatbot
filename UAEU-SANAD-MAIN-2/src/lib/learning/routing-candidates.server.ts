/**
 * Candidate generation and validation for adaptive routing.
 *
 * Observe → learn pattern → validate on history → shadow → activate safely →
 * monitor → correct → roll back. Nothing here invents policy: a candidate can
 * only ever change which service a phrase points at, under a stated context.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification } from "../ops/notify.server";
import { maskExample, sharedKeywords } from "./privacy";
import {
  autoActivationVerdict,
  classifyRuleRisk,
  evidenceThreshold,
  normalizePhrase,
  phraseLanguage,
  replayRule,
  shadowPromotionReady,
  shouldPauseRule,
  type LearningConfig,
  type ReplayCase,
  type ReplayResult,
  type RoutingRule,
} from "./routing-improvement";
import { loadLearningConfig } from "./rules.server";

/** Text that marks a record as demo, synthetic or a test fixture. */
const EXCLUDED_TEXT_RE =
  /(demo|synthetic|benchmark|test fixture|sample data|lorem ipsum|بيانات تجريبية|اختبار)/i;

type Signal = {
  id: string;
  correction_type: string;
  correction_source: string;
  original_domain: string | null;
  corrected_domain: string | null;
  original_intent: string | null;
  corrected_intent: string | null;
  original_unit_id: string | null;
  corrected_unit_id: string | null;
  original_user_text: string | null;
  relevant_context_summary: string | null;
  staff_comment: string | null;
  student_feedback: string | null;
  reason_code: string | null;
  policy_sensitive: boolean | null;
  outcome: string | null;
  status: string | null;
};

const SIGNAL_COLUMNS =
  "id, correction_type, correction_source, original_domain, corrected_domain, original_intent, corrected_intent, original_unit_id, corrected_unit_id, original_user_text, relevant_context_summary, staff_comment, student_feedback, reason_code, policy_sensitive, outcome, status";

const ROUTING_CORRECTION_TYPES = [
  "ROUTING_CORRECTION",
  "UNIT_REASSIGNMENT",
  "INTENT_CORRECTION",
  "DOMAIN_CORRECTION",
  "STUDENT_CLARIFICATION",
];

/** Only evidence that is real, resolved and not rejected may teach anything. */
export function usableSignal(s: Signal): boolean {
  if (s.policy_sensitive) return false;
  if (s.status === "DISMISSED") return false;
  if (!ROUTING_CORRECTION_TYPES.includes(s.correction_type)) return false;
  const corrected = s.corrected_domain ?? s.corrected_intent ?? s.corrected_unit_id;
  if (!corrected) return false; // unresolved / ambiguous
  const text = `${s.original_user_text ?? ""} ${s.staff_comment ?? ""} ${s.reason_code ?? ""}`;
  if (EXCLUDED_TEXT_RE.test(text)) return false;
  if (!s.original_user_text || normalizePhrase(s.original_user_text).length < 3) return false;
  return true;
}

type Cluster = {
  key: string;
  targetDomain: string | null;
  targetUnitId: string | null;
  pendingDomain: string | null;
  language: "en" | "ar" | "both";
  rows: Signal[];
};

function clusterKey(s: Signal) {
  const target = s.corrected_domain ?? s.corrected_intent ?? s.corrected_unit_id ?? "none";
  const pending = s.original_domain ?? "none";
  return `${pending}->${target}`;
}

export function clusterSignals(signals: Signal[]): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const s of signals) {
    if (!usableSignal(s)) continue;
    const key = clusterKey(s);
    const lang = phraseLanguage(s.original_user_text ?? "");
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(s);
      if (existing.language !== lang) existing.language = "both";
    } else {
      map.set(key, {
        key,
        targetDomain: s.corrected_domain ?? s.corrected_intent ?? null,
        targetUnitId: s.corrected_unit_id ?? null,
        pendingDomain: s.original_domain ?? null,
        language: lang,
        rows: [s],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
}

function replayCasesFrom(signals: Signal[]): ReplayCase[] {
  return signals
    .filter((s) => s.original_user_text)
    .map((s) => {
      const correct = s.corrected_domain ?? s.corrected_intent ?? s.corrected_unit_id ?? null;
      const actual = s.original_domain ?? s.original_unit_id ?? null;
      return {
        message: s.original_user_text as string,
        language: phraseLanguage(s.original_user_text as string),
        pendingDomain: s.original_domain ?? null,
        correctTarget: correct,
        actualTarget: actual,
        wasCorrect: Boolean(actual && correct && actual === correct),
      } satisfies ReplayCase;
    });
}

function draftRule(cluster: Cluster, config: LearningConfig): RoutingRule & { phrases: string[] } {
  const texts = cluster.rows.map((r) => r.original_user_text ?? "").filter(Boolean);
  const phrases = sharedKeywords(texts);
  const ruleType = cluster.pendingDomain ? "PENDING_DISAMBIGUATION" : "SERVICE_ALIAS";
  const riskText = `${texts.join(" ")} ${cluster.rows.map((r) => r.staff_comment ?? "").join(" ")}`;
  const crossesUnitOwnership = Boolean(
    cluster.targetUnitId && cluster.rows.some((r) => r.original_unit_id && r.original_unit_id !== cluster.targetUnitId),
  );
  const risk = classifyRuleRisk({ ruleType, text: riskText, crossesUnitOwnership });
  const evidence = cluster.rows.length;
  const confidence = Math.min(0.95, 0.45 + 0.06 * evidence);
  void config;

  return {
    id: cluster.key,
    rule_name: `Learned routing: "${phrases.slice(0, 2).join(", ")}" → ${cluster.targetDomain ?? "service"}`,
    description: `${evidence} corrections moved these requests to ${cluster.targetDomain ?? "another service"}${
      cluster.pendingDomain ? ` while a ${cluster.pendingDomain} step was open` : ""
    }.`,
    rule_type: ruleType,
    trigger_phrases: phrases,
    trigger_patterns: [],
    required_context: cluster.pendingDomain ? { pending_domain: cluster.pendingDomain } : {},
    excluded_context: {},
    source_language: cluster.language,
    pending_domain: cluster.pendingDomain,
    target_domain: cluster.targetDomain,
    target_intent: null,
    target_service: null,
    target_service_id: null,
    target_unit_id: cluster.targetUnitId,
    priority: cluster.pendingDomain ? 40 : 60,
    confidence: Number(confidence.toFixed(3)),
    evidence_count: evidence,
    risk_level: risk,
    status: "PROPOSED",
    activation_mode: "HUMAN_APPROVAL",
    phrases,
  };
}

export type RoutingCandidateResult = {
  examined: number;
  clusters: number;
  proposed: number;
  shadowed: number;
  autoActivated: number;
  skipped: { reason: string; key: string }[];
};

/**
 * Builds routing candidates from repeated corrections, replays each one over
 * history, and puts it into shadow mode. Only low-risk wording rules that also
 * pass replay may ever switch themselves on.
 */
export async function buildRoutingCandidates(
  opts: { windowDays?: number } = {},
): Promise<RoutingCandidateResult> {
  const since = new Date(Date.now() - (opts.windowDays ?? 120) * 86_400_000).toISOString();
  const config = await loadLearningConfig();
  const { data } = await supabaseAdmin
    .from("learning_signals")
    .select(SIGNAL_COLUMNS)
    .gte("created_at", since)
    .limit(4000);
  const signals = ((data ?? []) as unknown as Signal[]).filter(usableSignal);
  const clusters = clusterSignals(signals);
  const history = replayCasesFrom(signals);

  const result: RoutingCandidateResult = {
    examined: signals.length,
    clusters: clusters.length,
    proposed: 0,
    shadowed: 0,
    autoActivated: 0,
    skipped: [],
  };

  for (const cluster of clusters) {
    const draft = draftRule(cluster, config);
    const risk = (draft.risk_level ?? "medium") as "low" | "medium" | "high";
    const threshold = evidenceThreshold(risk, config);
    if (cluster.rows.length < threshold) {
      result.skipped.push({ reason: `below ${threshold} examples`, key: cluster.key });
      continue;
    }
    if (!draft.trigger_phrases?.length) {
      result.skipped.push({ reason: "no shared wording", key: cluster.key });
      continue;
    }

    const replay = replayRule(draft, history);
    if (replay.regressions > 0) {
      result.skipped.push({ reason: "would break routes that were already correct", key: cluster.key });
      continue;
    }

    const verdict = autoActivationVerdict({
      rule: { ...draft, historical_accuracy: replay.accuracy },
      replay,
      config,
    });

    const existing = await findExistingRule(cluster.key);
    if (existing && ["REJECTED", "ROLLED_BACK", "ACTIVE", "APPROVED"].includes(String(existing.status))) {
      result.skipped.push({ reason: `already ${existing.status}`, key: cluster.key });
      continue;
    }

    const status = verdict.eligible ? "SHADOW" : "PROPOSED";
    const payload = {
      rule_name: draft.rule_name,
      description: draft.description ?? null,
      rule_type: draft.rule_type,
      trigger_context: cluster.key,
      trigger_phrases: draft.trigger_phrases ?? [],
      trigger_patterns: [],
      required_context: (draft.required_context ?? {}) as Record<string, never>,
      excluded_context: {} as Record<string, never>,
      source_language: draft.source_language ?? "both",
      pending_domain: draft.pending_domain ?? null,
      target_domain: draft.target_domain ?? null,
      target_unit_id: draft.target_unit_id ?? null,
      priority: draft.priority,
      confidence: draft.confidence,
      evidence_count: draft.evidence_count ?? 0,
      historical_accuracy: replay.accuracy,
      risk_level: risk,
      status,
      activation_mode: verdict.mode,
      active: false,
      last_evaluated_at: new Date().toISOString(),
      baseline_metrics: {
        replay,
        reasons: verdict.reasons,
        examples: cluster.rows.slice(0, 5).map((r) => maskExample(r.original_user_text, 160)),
      } as unknown as Record<string, never>,
    };

    let ruleId = existing?.id ?? null;
    if (ruleId) {
      await supabaseAdmin.from("learned_routing_rules").update(payload).eq("id", ruleId);
    } else {
      const { data: inserted } = await supabaseAdmin
        .from("learned_routing_rules")
        .insert({ ...payload, effective_from: new Date().toISOString() })
        .select("id")
        .single();
      ruleId = (inserted?.id as string | undefined) ?? null;
    }
    if (status === "SHADOW") result.shadowed += 1;
    else result.proposed += 1;

    if (ruleId) {
      await supabaseAdmin
        .from("learning_signals")
        .update({ status: "CLUSTERED" })
        .in(
          "id",
          cluster.rows.map((r) => r.id),
        );
      if (status === "PROPOSED") await notifyReviewers(draft.rule_name, ruleId, verdict.reasons);
    }
  }

  return result;
}

async function findExistingRule(triggerContext: string) {
  const { data } = await supabaseAdmin
    .from("learned_routing_rules")
    .select("id, status")
    .eq("trigger_context", triggerContext)
    .maybeSingle();
  return data as { id: string; status: string } | null;
}

async function notifyReviewers(title: string, ruleId: string, reasons: string[]) {
  try {
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["system_admin", "service_manager"]);
    for (const a of admins ?? []) {
      await emitNotification({
        eventType: "learning_candidate_ready",
        entityType: "learned_routing_rule",
        entityId: ruleId,
        recipientId: a.user_id as string,
        language: "en",
        vars: { title, reason: reasons[0] ?? "Needs a human decision" },
        actionUrl: "/learning",
        dedupeKey: `learning-routing:${ruleId}:${a.user_id}`,
      });
    }
  } catch {
    /* best effort */
  }
}

export type RuleEvaluationResult = {
  evaluated: number;
  promoted: number;
  paused: number;
};

/**
 * Periodic review of every learned rule already in flight: promote shadow rules
 * that proved themselves, and pause live rules that people keep overriding.
 */
export async function evaluateLearnedRules(): Promise<RuleEvaluationResult> {
  const config = await loadLearningConfig();
  const { data } = await supabaseAdmin
    .from("learned_routing_rules")
    .select(
      "id, rule_name, status, activation_mode, risk_level, confidence, evidence_count, historical_accuracy, shadow_accuracy, shadow_samples, success_count, failure_count",
    )
    .in("status", ["SHADOW", "ACTIVE"]);

  const rules = (data ?? []) as unknown as RoutingRule[];
  const out: RuleEvaluationResult = { evaluated: rules.length, promoted: 0, paused: 0 };
  const now = new Date().toISOString();

  for (const rule of rules) {
    if (rule.status === "SHADOW") {
      if (!shadowPromotionReady(rule, config)) continue;
      const canAuto =
        rule.activation_mode === "AUTO" &&
        config.auto_activation_enabled &&
        (rule.risk_level ?? "medium") === "low" &&
        Number(rule.historical_accuracy ?? 0) >= config.min_historical_accuracy;
      await supabaseAdmin
        .from("learned_routing_rules")
        .update({
          status: canAuto ? "ACTIVE" : "VALIDATED",
          active: canAuto,
          ...(canAuto ? { approved_at: now } : {}),
          last_evaluated_at: now,
        })
        .eq("id", rule.id);
      if (canAuto) out.promoted += 1;
      continue;
    }

    const verdict = shouldPauseRule(
      {
        confidence: Number(rule.confidence ?? 0.5),
        success_count: rule.success_count ?? 0,
        failure_count: rule.failure_count ?? 0,
      },
      config,
    );
    await supabaseAdmin
      .from("learned_routing_rules")
      .update({
        confidence: verdict.confidence,
        last_evaluated_at: now,
        ...(verdict.pause
          ? { status: "PAUSED", active: false, paused_at: now, rollback_reason: verdict.reason }
          : {}),
      })
      .eq("id", rule.id);
    if (verdict.pause) out.paused += 1;
  }

  return out;
}

/** Before/after routing quality for the Learning Center. */
export async function routingImprovementMetrics(): Promise<{
  rules: number;
  active: number;
  shadow: number;
  paused: number;
  applied: number;
  overrides: number;
  successRate: number | null;
  decisions: number;
}> {
  const [{ data: rules }, { data: decisions }] = await Promise.all([
    supabaseAdmin
      .from("learned_routing_rules")
      .select("id, status, applied_count, success_count, failure_count"),
    supabaseAdmin.from("learned_rule_decisions").select("id, mode, outcome").limit(2000),
  ]);
  const list = (rules ?? []) as Record<string, number | string>[];
  const success = list.reduce((n, r) => n + Number(r["success_count"] ?? 0), 0);
  const failure = list.reduce((n, r) => n + Number(r["failure_count"] ?? 0), 0);
  return {
    rules: list.length,
    active: list.filter((r) => r["status"] === "ACTIVE").length,
    shadow: list.filter((r) => r["status"] === "SHADOW").length,
    paused: list.filter((r) => r["status"] === "PAUSED").length,
    applied: list.reduce((n, r) => n + Number(r["applied_count"] ?? 0), 0),
    overrides: failure,
    successRate: success + failure ? Number((success / (success + failure)).toFixed(3)) : null,
    decisions: (decisions ?? []).length,
  };
}

export type { ReplayResult };
