/**
 * Acceptance tests A–G for the governed learning layer.
 * Every test asserts the same promise: Sanadi may notice and propose,
 * but only a person can change how students are served.
 */
import { describe, it, expect } from "vitest";
import { detectNaturalCorrection } from "./natural-correction";
import { groupSignalsIntoCandidates, isPolicySensitive, type SignalRow } from "./patterns";
import { matchLearnedRule, type LearnedRule } from "./rules.server";
import { maskExample } from "./privacy";
import { DEFAULT_PATTERN_THRESHOLD, FEEDBACK_REASONS } from "./types";

const CAREER = "11111111-1111-4111-8111-111111111111";
const HELPDESK = "22222222-2222-4222-8222-222222222222";

function signal(partial: Partial<SignalRow> & { id: string }): SignalRow {
  return {
    correction_type: "ROUTING_CORRECTION",
    original_domain: "appointments",
    corrected_domain: "career",
    original_intent: null,
    corrected_intent: null,
    original_unit_id: HELPDESK,
    corrected_unit_id: CAREER,
    original_user_text: "career center",
    staff_comment: null,
    student_feedback: null,
    reason_code: null,
    policy_sensitive: false,
    case_id: null,
    ...partial,
  };
}

describe("A — natural-language corrections are detected", () => {
  it("recognises an English correction naming a service", () => {
    const r = detectNaturalCorrection("no, I meant the career center");
    expect(r.isCorrection).toBe(true);
    expect(r.correctionType).toBe("ROUTING_CORRECTION");
  });

  it("recognises an Arabic correction", () => {
    expect(detectNaturalCorrection("لا، أقصد مركز التوظيف").isCorrection).toBe(true);
  });

  it("leaves an ordinary question alone", () => {
    expect(detectNaturalCorrection("when does the library close?").isCorrection).toBe(false);
  });
});

describe("B — a pattern needs repetition before it is proposed", () => {
  it("stays silent below the threshold", () => {
    const rows = [signal({ id: "1" }), signal({ id: "2" })];
    expect(groupSignalsIntoCandidates(rows)).toHaveLength(0);
  });

  it("proposes once the same correction repeats three times", () => {
    const rows = [signal({ id: "1" }), signal({ id: "2" }), signal({ id: "3" })];
    const drafts = groupSignalsIntoCandidates(rows);
    expect(DEFAULT_PATTERN_THRESHOLD).toBe(3);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.candidate_type).toBe("ROUTING_RULE");
    expect(drafts[0]!.evidence_count).toBe(3);
    expect(drafts[0]!.proposed_change["kind"]).toBe("routing_rule");
  });

  it("honours a configured threshold", () => {
    const rows = [signal({ id: "1" }), signal({ id: "2" })];
    expect(groupSignalsIntoCandidates(rows, { threshold: 2 })).toHaveLength(1);
  });
});

describe("C — policy, eligibility and permissions are never learned", () => {
  it("flags policy-sensitive text", () => {
    expect(
      isPolicySensitive({
        staff_comment: "the transfer eligibility rule should be 2.0 GPA",
        student_feedback: null,
        original_user_text: null,
      }),
    ).toBe(true);
    expect(
      isPolicySensitive({ staff_comment: "route this to the library", student_feedback: null, original_user_text: null }),
    ).toBe(false);
  });

  it("drops policy-sensitive signals from grouping entirely", () => {
    const rows = [
      signal({ id: "1", staff_comment: "graduation requirement is wrong" }),
      signal({ id: "2", staff_comment: "graduation requirement is wrong" }),
      signal({ id: "3", staff_comment: "graduation requirement is wrong" }),
    ];
    expect(groupSignalsIntoCandidates(rows)).toHaveLength(0);
  });
});

describe("D — an approved rule refines an unclear turn", () => {
  const rule: LearnedRule = {
    id: "r1",
    rule_name: "career center → Career Services",
    trigger_context: null,
    trigger_phrases: ["career center"],
    pending_domain: null,
    target_domain: "career",
    target_service: null,
    target_unit_id: CAREER,
    priority: 10,
    confidence: 0.9,
  };

  it("matches the appointment 'career center' phrasing", () => {
    expect(matchLearnedRule([rule], { message: "I need the career center" })?.id).toBe("r1");
  });

  it("never overrides a clear explicit request for another service", () => {
    expect(
      matchLearnedRule([rule], { message: "book the career center", explicitDomains: ["library"] }),
    ).toBeNull();
  });

  it("respects a pending-state restriction", () => {
    const scoped = { ...rule, pending_domain: "APPOINTMENT" };
    expect(matchLearnedRule([scoped], { message: "career center" })).toBeNull();
    expect(
      matchLearnedRule([scoped], { message: "career center", pendingDomain: "APPOINTMENT" })?.id,
    ).toBe("r1");
  });
});

describe("E — alert routing corrections cluster into their own proposal", () => {
  it("groups repeated alert reassignments separately from appointments", () => {
    const alerts = [1, 2, 3].map((n) =>
      signal({
        id: `a${n}`,
        original_domain: "alerts",
        corrected_domain: "alerts",
        original_unit_id: HELPDESK,
        corrected_unit_id: CAREER,
        original_user_text: "power cut in the lab",
      }),
    );
    const drafts = groupSignalsIntoCandidates([...alerts, signal({ id: "x" })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.affected_domains).toContain("alerts");
  });
});

describe("F — knowledge gaps stay questions, never policy", () => {
  it("proposes a knowledge gap without writing staff text into a rule", () => {
    const rows = [1, 2, 3].map((n) =>
      signal({
        id: `k${n}`,
        correction_type: "KNOWLEDGE_GAP",
        original_domain: "library",
        corrected_domain: null,
        original_unit_id: null,
        corrected_unit_id: null,
        original_user_text: "how do I renew a borrowed book",
        staff_comment: "tell them renewals last 14 days",
      }),
    );
    const draft = groupSignalsIntoCandidates(rows)[0]!;
    expect(draft.candidate_type).toBe("KNOWLEDGE_GAP");
    expect(draft.proposed_change["kind"]).not.toBe("routing_rule");
    expect(JSON.stringify(draft.proposed_change)).not.toContain("renewals last 14 days");
  });
});

describe("G — student feedback and examples stay private", () => {
  it("offers a bilingual reason for every feedback option", () => {
    for (const r of FEEDBACK_REASONS) {
      expect(r.en.length).toBeGreaterThan(2);
      expect(r.ar.length).toBeGreaterThan(2);
    }
  });

  it("masks identifying details in stored examples", () => {
    const masked = maskExample("email me at nzaki@uaeu.ac.ae about UAEU-2026-01051, call 0501234567");
    expect(masked).not.toContain("nzaki@uaeu.ac.ae");
    expect(masked).not.toContain("0501234567");
    expect(masked).not.toContain("UAEU-2026-01051");
  });
});
