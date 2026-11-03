/**
 * Governed adaptive routing — pure logic, no I/O.
 *
 * Sanadi may learn *how people phrase things* (aliases, synonyms, contextual
 * routing, clarification behaviour). It may never learn policy, eligibility,
 * permissions, approvals, security, academic requirements, financial rules or
 * service levels: those stay human decisions, permanently.
 *
 * Lifecycle: PROPOSED → SHADOW → VALIDATED → ACTIVE → (PAUSED | ROLLED_BACK).
 */
import { FORBIDDEN_LEARNING_RE } from "./types";

export const RULE_STATUSES = [
  "PROPOSED",
  "SHADOW",
  "VALIDATING",
  "VALIDATED",
  "APPROVED",
  "ACTIVE",
  "PAUSED",
  "REJECTED",
  "ROLLED_BACK",
] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const ACTIVATION_MODES = ["AUTO", "HUMAN_APPROVAL"] as const;
export type ActivationMode = (typeof ACTIVATION_MODES)[number];

export const ROUTING_RULE_TYPES = [
  "INTENT_ALIAS",
  "DOMAIN_ALIAS",
  "SERVICE_ALIAS",
  "UNIT_ALIAS",
  "PENDING_DISAMBIGUATION",
  "PHRASE_CONTEXT",
  "CLARIFICATION_ANSWER",
  "SERVICE_SYNONYM",
  "TOOL_HINT",
] as const;
export type RoutingRuleType = (typeof ROUTING_RULE_TYPES)[number];

/** Rule types that are inherently low-risk wording work. */
const LOW_RISK_TYPES: RoutingRuleType[] = [
  "INTENT_ALIAS",
  "DOMAIN_ALIAS",
  "SERVICE_ALIAS",
  "UNIT_ALIAS",
  "SERVICE_SYNONYM",
  "PENDING_DISAMBIGUATION",
  "CLARIFICATION_ANSWER",
];

/** Subjects that force human approval no matter how strong the evidence is. */
const HIGH_RISK_RE =
  /(eligib|graduation|degree requirement|programme rule|program rule|gpa|credit limit|permission|privilege|role|fee|fees|tuition|payment|refund|financial|sla|service level|policy|regulation|security|escalation policy|approval|ownership|أهلية|تخرج|صلاحي|رسوم|مالي|أمن|سياسة|اعتماد|تصعيد|مستوى الخدمة)/i;

export type LearningConfig = {
  threshold_low: number;
  threshold_normal: number;
  threshold_high: number;
  min_historical_accuracy: number;
  min_shadow_samples: number;
  min_shadow_accuracy: number;
  auto_activation_enabled: boolean;
  pause_confidence: number;
  pause_failure_streak: number;
};

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  threshold_low: 3,
  threshold_normal: 5,
  threshold_high: 10,
  min_historical_accuracy: 0.95,
  min_shadow_samples: 10,
  min_shadow_accuracy: 0.9,
  auto_activation_enabled: true,
  pause_confidence: 0.55,
  pause_failure_streak: 3,
};

export type RoutingRule = {
  id: string;
  rule_name: string;
  description?: string | null;
  rule_type: string;
  trigger_phrases: string[] | null;
  trigger_patterns?: string[] | null;
  required_context?: Record<string, unknown> | null;
  excluded_context?: Record<string, unknown> | null;
  source_language?: string | null;
  pending_domain?: string | null;
  target_domain: string | null;
  target_intent?: string | null;
  target_service?: string | null;
  target_service_id?: string | null;
  target_unit_id: string | null;
  priority: number;
  confidence: number;
  evidence_count?: number | null;
  historical_accuracy?: number | null;
  shadow_accuracy?: number | null;
  shadow_samples?: number | null;
  risk_level?: string | null;
  status?: string | null;
  activation_mode?: string | null;
  success_count?: number | null;
  failure_count?: number | null;
};

/** Everything a learned rule is allowed to look at when deciding. */
export type RoutingContext = {
  message: string;
  language?: "en" | "ar" | null;
  pendingDomain?: string | null;
  pendingQuestion?: string | null;
  activeDomain?: string | null;
  previousAssistantQuestion?: string | null;
  explicitDomains?: string[];
  explicitTopicChange?: boolean;
  mentionedUnitId?: string | null;
  role?: string | null;
  workflowStage?: string | null;
  caseType?: string | null;
};

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function normalizePhrase(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function phraseLanguage(text: string): "en" | "ar" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

const CONTEXT_KEYS = [
  "pending_domain",
  "pending_question",
  "active_domain",
  "previous_assistant_question",
  "mentioned_unit_id",
  "role",
  "workflow_stage",
  "case_type",
  "language",
] as const;

function contextValue(ctx: RoutingContext, key: string): string | null {
  switch (key) {
    case "pending_domain":
      return ctx.pendingDomain ?? null;
    case "pending_question":
      return ctx.pendingQuestion ?? null;
    case "active_domain":
      return ctx.activeDomain ?? null;
    case "previous_assistant_question":
      return ctx.previousAssistantQuestion ?? null;
    case "mentioned_unit_id":
      return ctx.mentionedUnitId ?? null;
    case "role":
      return ctx.role ?? null;
    case "workflow_stage":
      return ctx.workflowStage ?? null;
    case "case_type":
      return ctx.caseType ?? null;
    case "language":
      return ctx.language ?? null;
    default:
      return null;
  }
}

function valueMatches(expected: unknown, actual: string | null): boolean {
  if (Array.isArray(expected)) return expected.some((e) => valueMatches(e, actual));
  if (expected === null) return actual === null;
  if (typeof expected !== "string") return false;
  if (actual === null) return false;
  return expected.toUpperCase() === actual.toUpperCase();
}

/** How specific a rule is: more matched context keys wins over a bare keyword. */
export function ruleSpecificity(rule: RoutingRule): number {
  const required = rule.required_context ?? {};
  let score = Object.keys(required).filter((k) => (CONTEXT_KEYS as readonly string[]).includes(k)).length;
  if (rule.pending_domain) score += 1;
  if (rule.source_language && rule.source_language !== "both") score += 0.5;
  return score;
}

export type RuleMatch = {
  rule: RoutingRule;
  matchedPhrase: string;
  specificity: number;
};

function phraseHit(rule: RoutingRule, normalizedMessage: string): string | null {
  for (const phrase of rule.trigger_phrases ?? []) {
    const p = normalizePhrase(phrase);
    if (p && normalizedMessage.includes(p)) return phrase;
  }
  for (const pattern of rule.trigger_patterns ?? []) {
    try {
      if (new RegExp(pattern, "iu").test(normalizedMessage)) return pattern;
    } catch {
      /* a malformed stored pattern never breaks a turn */
    }
  }
  return null;
}

/**
 * Finds the best learned rule for this turn, or null.
 *
 * Hard guarantees:
 *  - a rule never overrides an explicit current request;
 *  - a rule bound to a pending workflow never fires after the student changes
 *    the topic outright;
 *  - a rule written for one language never fires in the other unless it was
 *    validated for both.
 */
export function matchRoutingRules(rules: RoutingRule[], ctx: RoutingContext): RuleMatch | null {
  const message = normalizePhrase(ctx.message);
  if (!message) return null;
  const explicit = new Set((ctx.explicitDomains ?? []).map((d) => d.toUpperCase()));
  const lang = ctx.language ?? phraseLanguage(ctx.message);

  const matches: RuleMatch[] = [];
  for (const rule of rules) {
    const ruleLang = (rule.source_language ?? "both").toLowerCase();
    if (ruleLang !== "both" && ruleLang !== lang) continue;

    const required = (rule.required_context ?? {}) as Record<string, unknown>;
    const excluded = (rule.excluded_context ?? {}) as Record<string, unknown>;

    // An explicit topic change ends every pending-workflow rule.
    const needsPending = Boolean(rule.pending_domain) || "pending_domain" in required;
    if (ctx.explicitTopicChange && needsPending) continue;

    if (rule.pending_domain && !valueMatches(rule.pending_domain, ctx.pendingDomain ?? null)) continue;

    let ok = true;
    for (const [key, expected] of Object.entries(required)) {
      if (!valueMatches(expected, contextValue(ctx, key))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const [key, forbidden] of Object.entries(excluded)) {
      if (valueMatches(forbidden, contextValue(ctx, key))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const matchedPhrase = phraseHit(rule, message);
    if (!matchedPhrase) continue;

    // Explicit current request always wins over a learned rule.
    if (explicit.size && rule.target_domain && !explicit.has(rule.target_domain.toUpperCase())) continue;

    matches.push({ rule, matchedPhrase, specificity: ruleSpecificity(rule) });
  }

  if (!matches.length) return null;
  matches.sort(
    (a, b) =>
      b.specificity - a.specificity ||
      a.rule.priority - b.rule.priority ||
      Number(b.rule.confidence) - Number(a.rule.confidence),
  );
  return matches[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Risk, thresholds and eligibility                                    */
/* ------------------------------------------------------------------ */

export function classifyRuleRisk(input: {
  ruleType?: string | null;
  text?: string | null;
  crossesUnitOwnership?: boolean;
}): "low" | "medium" | "high" {
  const text = input.text ?? "";
  if (FORBIDDEN_LEARNING_RE.test(text) || HIGH_RISK_RE.test(text)) return "high";
  if (input.crossesUnitOwnership) return "medium";
  if (LOW_RISK_TYPES.includes((input.ruleType ?? "") as RoutingRuleType)) return "low";
  return "medium";
}

export function evidenceThreshold(
  risk: "low" | "medium" | "high",
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): number {
  if (risk === "low") return config.threshold_low;
  if (risk === "medium") return config.threshold_normal;
  return config.threshold_high;
}

export type ReplayCase = {
  message: string;
  language?: "en" | "ar" | null;
  pendingDomain?: string | null;
  pendingQuestion?: string | null;
  activeDomain?: string | null;
  explicitDomains?: string[];
  /** What the route should have been, per the human correction or outcome. */
  correctTarget: string | null;
  /** What routing actually chose at the time. */
  actualTarget?: string | null;
  /** True when the historical route was already correct (regression check). */
  wasCorrect?: boolean;
};

export type ReplayResult = {
  affected: number;
  correct: number;
  incorrect: number;
  ambiguous: number;
  regressions: number;
  accuracy: number;
  byLanguage: Record<string, { affected: number; correct: number; accuracy: number }>;
};

function ruleTarget(rule: RoutingRule): string | null {
  return rule.target_domain ?? rule.target_unit_id ?? rule.target_intent ?? null;
}

/** Replays a candidate rule over historical interactions before it is trusted. */
export function replayRule(rule: RoutingRule, cases: ReplayCase[]): ReplayResult {
  const byLanguage: ReplayResult["byLanguage"] = {};
  let affected = 0;
  let correct = 0;
  let incorrect = 0;
  let ambiguous = 0;
  let regressions = 0;
  const target = ruleTarget(rule);

  for (const c of cases) {
    const ctx: RoutingContext = {
      message: c.message,
      ...(c.language !== undefined ? { language: c.language } : {}),
      ...(c.pendingDomain !== undefined ? { pendingDomain: c.pendingDomain } : {}),
      ...(c.pendingQuestion !== undefined ? { pendingQuestion: c.pendingQuestion } : {}),
      ...(c.activeDomain !== undefined ? { activeDomain: c.activeDomain } : {}),
      ...(c.explicitDomains !== undefined ? { explicitDomains: c.explicitDomains } : {}),
    };
    const hit = matchRoutingRules([rule], ctx);
    if (!hit) continue;
    affected += 1;
    const lang = c.language ?? phraseLanguage(c.message);
    const bucket = (byLanguage[lang] ??= { affected: 0, correct: 0, accuracy: 0 });
    bucket.affected += 1;

    if (!c.correctTarget) {
      ambiguous += 1;
      continue;
    }
    const matchesTarget = target !== null && c.correctTarget.toUpperCase() === target.toUpperCase();
    if (matchesTarget) {
      correct += 1;
      bucket.correct += 1;
    } else {
      incorrect += 1;
      if (c.wasCorrect) regressions += 1;
    }
  }

  for (const bucket of Object.values(byLanguage)) {
    bucket.accuracy = bucket.affected ? Number((bucket.correct / bucket.affected).toFixed(4)) : 0;
  }
  const decided = correct + incorrect;
  return {
    affected,
    correct,
    incorrect,
    ambiguous,
    regressions,
    accuracy: decided ? Number((correct / decided).toFixed(4)) : 0,
    byLanguage,
  };
}

export type ActivationVerdict = {
  eligible: boolean;
  mode: ActivationMode;
  reasons: string[];
};

/**
 * Decides whether a validated rule may switch itself on.
 * Only low-risk wording work ever qualifies; everything else waits for a human.
 */
export function autoActivationVerdict(input: {
  rule: RoutingRule;
  replay: ReplayResult;
  config?: LearningConfig;
}): ActivationVerdict {
  const config = input.config ?? DEFAULT_LEARNING_CONFIG;
  const rule = input.rule;
  const reasons: string[] = [];
  const risk = (rule.risk_level ?? "medium") as "low" | "medium" | "high";
  const evidence = rule.evidence_count ?? 0;
  const threshold = evidenceThreshold(risk, config);

  if (!config.auto_activation_enabled) reasons.push("Automatic activation is switched off");
  if (risk !== "low") reasons.push("Only low-risk routing wording can activate automatically");
  if (evidence < threshold) reasons.push(`Needs ${threshold} similar corrections (has ${evidence})`);
  if (input.replay.accuracy < config.min_historical_accuracy) {
    reasons.push(
      `Historical accuracy ${Math.round(input.replay.accuracy * 100)}% is below ${Math.round(
        config.min_historical_accuracy * 100,
      )}%`,
    );
  }
  if (input.replay.regressions > 0) reasons.push("It would change routes that were already correct");
  if (
    FORBIDDEN_LEARNING_RE.test(`${rule.rule_name} ${rule.description ?? ""}`) ||
    HIGH_RISK_RE.test(`${rule.rule_name} ${rule.description ?? ""}`)
  ) {
    reasons.push("Touches policy, eligibility, permissions, money, security or service levels");
  }

  return {
    eligible: reasons.length === 0,
    mode: reasons.length === 0 ? "AUTO" : "HUMAN_APPROVAL",
    reasons,
  };
}

export function shadowPromotionReady(
  rule: RoutingRule,
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): boolean {
  return (
    (rule.shadow_samples ?? 0) >= config.min_shadow_samples &&
    Number(rule.shadow_accuracy ?? 0) >= config.min_shadow_accuracy
  );
}

/* ------------------------------------------------------------------ */
/* Confidence decay and pausing                                        */
/* ------------------------------------------------------------------ */

/**
 * Trust is re-earned, not granted once. Every staff override and every student
 * correction pulls the rule's confidence down; a steady record lifts it back,
 * capped at the evidence it started from.
 */
export function decayedConfidence(rule: {
  confidence: number;
  success_count?: number | null;
  failure_count?: number | null;
}): number {
  const base = Number(rule.confidence ?? 0.5);
  const success = rule.success_count ?? 0;
  const failure = rule.failure_count ?? 0;
  const total = success + failure;
  if (!total) return Number(base.toFixed(3));
  const observed = success / total;
  // Weight observation more as evidence accumulates (up to 80%).
  const weight = Math.min(0.8, total / (total + 5));
  const value = base * (1 - weight) + observed * weight;
  return Number(Math.max(0, Math.min(0.99, value)).toFixed(3));
}

export function shouldPauseRule(
  rule: { confidence: number; success_count?: number | null; failure_count?: number | null },
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): { pause: boolean; confidence: number; reason: string | null } {
  const confidence = decayedConfidence(rule);
  const failures = rule.failure_count ?? 0;
  const successes = rule.success_count ?? 0;
  if (confidence < config.pause_confidence && failures + successes >= 2) {
    return { pause: true, confidence, reason: "Confidence fell below the safe level after corrections" };
  }
  if (failures >= config.pause_failure_streak && failures > successes) {
    return { pause: true, confidence, reason: "Staff repeatedly overrode this rule" };
  }
  return { pause: false, confidence, reason: null };
}

/** "Forget the appointment, I want career advice" — an outright topic change. */
export const EXPLICIT_TOPIC_CHANGE_RE =
  /\b(forget (it|that|the appointment)|never ?mind|cancel (that|the appointment)|instead of (that|the appointment))\b|انسى (الموعد|ذلك)|لا تهتم|بدلاً من ذلك/i;

export function isExplicitTopicChange(text: string): boolean {
  return EXPLICIT_TOPIC_CHANGE_RE.test(text ?? "");
}
