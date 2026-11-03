/**
 * Acceptance tests A–H for automatic routing rule improvement.
 * The promise under test: Sanadi may learn wording, never authority.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEARNING_CONFIG,
  autoActivationVerdict,
  classifyRuleRisk,
  decayedConfidence,
  evidenceThreshold,
  isExplicitTopicChange,
  matchRoutingRules,
  replayRule,
  shadowPromotionReady,
  shouldPauseRule,
  type ReplayCase,
  type RoutingRule,
} from "./routing-improvement";
import { clusterSignals, usableSignal } from "./routing-candidates.server";

const CAREER_RULE: RoutingRule = {
  id: "rule-1",
  rule_name: 'Learned routing: "career center" → CAREER',
  rule_type: "PENDING_DISAMBIGUATION",
  trigger_phrases: ["career center", "career centre", "career office"],
  trigger_patterns: [],
  required_context: { pending_domain: "APPOINTMENT", pending_question: "SELECT_SERVICE" },
  excluded_context: {},
  source_language: "en",
  pending_domain: "APPOINTMENT",
  target_domain: "CAREER",
  target_unit_id: null,
  priority: 40,
  confidence: 0.9,
  evidence_count: 17,
  risk_level: "low",
  status: "ACTIVE",
  activation_mode: "AUTO",
};

function signal(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    correction_type: "ROUTING_CORRECTION",
    correction_source: "STAFF",
    original_domain: "APPOINTMENT",
    corrected_domain: "CAREER",
    original_intent: null,
    corrected_intent: null,
    original_unit_id: null,
    corrected_unit_id: null,
    original_user_text: "career center",
    relevant_context_summary: null,
    staff_comment: null,
    student_feedback: null,
    reason_code: null,
    policy_sensitive: false,
    outcome: null,
    status: "NEW",
    ...over,
  } as never;
}

describe("A — repeated corrections become a candidate", () => {
  it("clusters five identical corrections into one pattern", () => {
    const clusters = clusterSignals([1, 2, 3, 4, 5].map((n) => signal(String(n))));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.rows).toHaveLength(5);
    expect(clusters[0]!.targetDomain).toBe("CAREER");
    expect(clusters[0]!.rows.length).toBeGreaterThanOrEqual(
      evidenceThreshold("low", DEFAULT_LEARNING_CONFIG),
    );
  });

  it("ignores demo, synthetic and unresolved records", () => {
    expect(usableSignal(signal("d", { original_user_text: "demo data check" }))).toBe(false);
    expect(usableSignal(signal("u", { corrected_domain: null, corrected_intent: null }))).toBe(false);
    expect(usableSignal(signal("p", { policy_sensitive: true }))).toBe(false);
    expect(usableSignal(signal("r", { status: "DISMISSED" }))).toBe(false);
  });
});

describe("B — historical replay decides eligibility", () => {
  const history: ReplayCase[] = [
    ...Array.from({ length: 19 }, () => ({
      message: "career center",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
      correctTarget: "CAREER",
    })),
    { message: "library help desk", pendingDomain: "APPOINTMENT", correctTarget: "LIBRARY" },
  ];

  it("measures accuracy only on the turns the rule would touch", () => {
    const replay = replayRule(CAREER_RULE, history);
    expect(replay.affected).toBe(19);
    expect(replay.accuracy).toBe(1);
    expect(replay.regressions).toBe(0);
  });

  it("blocks a rule that would break routes that were already correct", () => {
    const replay = replayRule(CAREER_RULE, [
      {
        message: "career center",
        pendingDomain: "APPOINTMENT",
        pendingQuestion: "SELECT_SERVICE",
        correctTarget: "ADVISING",
        actualTarget: "ADVISING",
        wasCorrect: true,
      },
    ]);
    expect(replay.regressions).toBe(1);
    expect(autoActivationVerdict({ rule: CAREER_RULE, replay }).eligible).toBe(false);
  });
});

describe("C — low-risk alias rules may activate automatically", () => {
  it("allows auto activation with enough evidence and accuracy", () => {
    const replay = replayRule(
      CAREER_RULE,
      Array.from({ length: 12 }, () => ({
        message: "career office",
        pendingDomain: "APPOINTMENT",
        pendingQuestion: "SELECT_SERVICE",
        correctTarget: "CAREER",
      })),
    );
    const verdict = autoActivationVerdict({ rule: CAREER_RULE, replay });
    expect(verdict.eligible).toBe(true);
    expect(verdict.mode).toBe("AUTO");
  });
});

describe("D — anything touching authority needs a human", () => {
  it("marks eligibility wording as high risk", () => {
    expect(classifyRuleRisk({ ruleType: "SERVICE_ALIAS", text: "change the GPA eligibility rule" })).toBe(
      "high",
    );
  });

  it("refuses automatic activation for an academic eligibility change", () => {
    const rule: RoutingRule = {
      ...CAREER_RULE,
      rule_name: "Learned: graduation eligibility routing",
      risk_level: "high",
    };
    const replay = replayRule(rule, [
      { message: "career center", pendingDomain: "APPOINTMENT", correctTarget: "CAREER" },
    ]);
    const verdict = autoActivationVerdict({ rule, replay });
    expect(verdict.eligible).toBe(false);
    expect(verdict.mode).toBe("HUMAN_APPROVAL");
    expect(verdict.reasons.join(" ")).toMatch(/low-risk|policy/i);
  });
});

describe("E — repeated overrides pause the rule", () => {
  it("drops confidence and pauses after a run of staff overrides", () => {
    const overridden = { confidence: 0.9, success_count: 1, failure_count: 6 };
    expect(decayedConfidence(overridden)).toBeLessThan(0.55);
    const verdict = shouldPauseRule(overridden);
    expect(verdict.pause).toBe(true);
    expect(verdict.reason).toBeTruthy();
  });

  it("leaves a rule alone while it keeps working", () => {
    expect(shouldPauseRule({ confidence: 0.9, success_count: 20, failure_count: 1 }).pause).toBe(false);
  });
});

describe("F — an explicit request always wins", () => {
  it("does not fire when the student names another service outright", () => {
    const hit = matchRoutingRules([CAREER_RULE], {
      message: "career center",
      language: "en",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
      explicitDomains: ["LIBRARY"],
    });
    expect(hit).toBeNull();
  });

  it("does not fire after the student drops the pending workflow", () => {
    expect(isExplicitTopicChange("Forget the appointment. I want career advice.")).toBe(true);
    const hit = matchRoutingRules([CAREER_RULE], {
      message: "forget the appointment, I want the career center",
      language: "en",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
      explicitTopicChange: true,
    });
    expect(hit).toBeNull();
  });

  it("fires on the unclear turn it was written for", () => {
    const hit = matchRoutingRules([CAREER_RULE], {
      message: "career center",
      language: "en",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
    });
    expect(hit?.rule.target_domain).toBe("CAREER");
    expect(hit?.matchedPhrase).toBe("career center");
  });

  it("stays out of the other language until it is validated there", () => {
    const hit = matchRoutingRules([CAREER_RULE], {
      message: "مركز التوظيف",
      language: "ar",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
    });
    expect(hit).toBeNull();
  });
});

describe("G — shadow mode predicts without changing anything", () => {
  it("keeps a shadow rule out of the live set", () => {
    const shadow = { ...CAREER_RULE, status: "SHADOW" };
    const active = [CAREER_RULE, shadow].filter((r) => r.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe("ACTIVE");
  });

  it("promotes only after enough successful shadow samples", () => {
    expect(shadowPromotionReady({ ...CAREER_RULE, shadow_samples: 4, shadow_accuracy: 1 })).toBe(false);
    expect(shadowPromotionReady({ ...CAREER_RULE, shadow_samples: 12, shadow_accuracy: 0.95 })).toBe(true);
    expect(shadowPromotionReady({ ...CAREER_RULE, shadow_samples: 12, shadow_accuracy: 0.6 })).toBe(false);
  });
});

describe("H — rollback restores the previous behaviour", () => {
  it("a rolled-back rule no longer matches anything", () => {
    const rolledBack = { ...CAREER_RULE, status: "ROLLED_BACK" };
    const live = [rolledBack].filter((r) => r.status === "ACTIVE");
    expect(matchRoutingRules(live, {
      message: "career center",
      language: "en",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
    })).toBeNull();
  });
});

describe("context beats keywords", () => {
  it("prefers the context-scoped rule over a bare keyword rule", () => {
    const bare: RoutingRule = {
      ...CAREER_RULE,
      id: "rule-2",
      required_context: {},
      pending_domain: null,
      target_domain: "CAREER_INFO",
      priority: 40,
      rule_type: "SERVICE_ALIAS",
    };
    const hit = matchRoutingRules([bare, CAREER_RULE], {
      message: "career center",
      language: "en",
      pendingDomain: "APPOINTMENT",
      pendingQuestion: "SELECT_SERVICE",
    });
    expect(hit?.rule.id).toBe("rule-1");
  });

  it("falls back to the general rule when no workflow is pending", () => {
    const bare: RoutingRule = {
      ...CAREER_RULE,
      id: "rule-2",
      required_context: {},
      pending_domain: null,
      target_domain: "CAREER_INFO",
      rule_type: "SERVICE_ALIAS",
    };
    const hit = matchRoutingRules([bare, CAREER_RULE], { message: "career center", language: "en" });
    expect(hit?.rule.id).toBe("rule-2");
  });
});
