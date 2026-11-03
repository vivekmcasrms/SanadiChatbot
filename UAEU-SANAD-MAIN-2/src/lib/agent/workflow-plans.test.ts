import { describe, expect, it } from "vitest";
import { classify } from "../agents.server";
import { selectWorkflowPlan } from "./workflow-plans.server";
import { decideSupervisor } from "./supervisor-policy.server";

describe("deterministic workflow plans", () => {
  it("selects career analysis but not a generic career mention", () => {
    expect(
      selectWorkflowPlan(["career"], classify("Which roles fit me?"), "Which roles fit me?")?.id,
    ).toBe("career-analysis");
    expect(
      selectWorkflowPlan(["career"], classify("Upload my CV please"), "Upload my CV please"),
    ).toBeNull();
  });

  it("selects the bilingual appointment plan", () => {
    expect(selectWorkflowPlan(["appointments"], classify("احجز لي موعداً"), "احجز لي موعداً")?.id).toBe("appointment-booking");
  });

  it("does not force a plan for cross-domain ambiguity", () => {
    expect(
      selectWorkflowPlan(["career", "appointments"], classify("career and appointment"), "career and appointment"),
    ).toBeNull();
  });

  it("skips a second model review when a workflow has verified prefetched records", () => {
    expect(decideSupervisor({
      classification: classify("Which roles fit me?"),
      proposedActions: [],
      sensitive: false,
      injectionAttempt: false,
      confidence: 0.4,
      confidenceThreshold: 0.55,
      evidenceVerified: true,
      emptyDraft: false,
    })).toEqual({ run: false, reason: null });
  });
});
