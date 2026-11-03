import { describe, expect, it } from "vitest";
import { classify } from "../agents.server";
import { decideSupervisor } from "./supervisor-policy.server";

describe("supervisor latency policy", () => {
  it("skips a verified proposal because preflight remains authoritative", () => {
    const result = decideSupervisor({
      classification: classify("Book this appointment"),
      proposedActions: [{ key: "book_appointment", toolName: "book_appointment", labelEn: "Book", labelAr: "حجز", risk: "level_2", affectedService: "Appointments", dataShared: "record", expectedOutcome: "booking" }],
      sensitive: false,
      injectionAttempt: false,
      confidence: 0.8,
      confidenceThreshold: 0.55,
      evidenceVerified: true,
      citationCount: 0,
      emptyDraft: false,
    });
    expect(result.run).toBe(false);
  });

  it("keeps high-risk review when evidence is absent", () => {
    const result = decideSupervisor({
      classification: classify("Book this appointment"),
      proposedActions: [{ key: "book_appointment", toolName: "book_appointment", labelEn: "Book", labelAr: "حجز", risk: "level_2", affectedService: "Appointments", dataShared: "record", expectedOutcome: "booking" }],
      sensitive: false,
      injectionAttempt: false,
      confidence: 0.8,
      confidenceThreshold: 0.55,
      evidenceVerified: false,
      citationCount: 0,
      emptyDraft: false,
    });
    expect(result.reason).toBe("high_impact_action");
  });
});