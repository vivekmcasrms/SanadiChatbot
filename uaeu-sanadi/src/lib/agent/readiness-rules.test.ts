import { describe, expect, it } from "vitest";
import { evaluateReadiness, type ReadinessInput } from "./readiness-rules";

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  totalCredits: 120,
  totalCreditsVerified: true,
  completedCredits: 120,
  completedCreditsKnown: true,
  registeredCredits: 0,
  gpa: 3.2,
  standing: "Good Standing",
  holdsKnown: true,
  holds: [],
  requirementsKnown: true,
  requirements: [],
  ...over,
});
const hold = { titleEn: "Finance hold", titleAr: "إيقاف مالي", resolutionEn: null, resolutionAr: null, blocksRegistration: true, blocksGraduation: true };

describe("graduation readiness", () => {
  it("15/120 credits is never graduation-ready or 'every check is clear'", () => {
    const ev = evaluateReadiness("graduation", base({ completedCredits: 15 }));
    expect(ev.eligibleToGraduate).toBe(false);
    expect(ev.allClear).toBe(false);
    expect(ev.summary.en).not.toMatch(/every|clear|met/i);
    expect(ev.summary.en).toMatch(/not yet eligible/);
    expect(ev.checks.find((c) => c.key === "credits")?.detail.en).toContain("105 remaining");
  });
  it("full credits but an active hold is not eligible", () => {
    const ev = evaluateReadiness("graduation", base({ holds: [hold] }));
    expect(ev.eligibleToGraduate).toBe(false);
    expect(ev.blockers).toBe(1);
  });
  it("good standing with incomplete requirements is not eligible", () => {
    const ev = evaluateReadiness("graduation", base({ requirements: [{ titleEn: "Capstone", titleAr: "مشروع التخرج", status: "pending", dueDate: null }] }));
    expect(ev.eligibleToGraduate).toBe(false);
    expect(ev.pending).toBe(1);
  });
  it("missing programme total is unknown, not a pass", () => {
    const ev = evaluateReadiness("graduation", base({ totalCreditsVerified: false }));
    expect(ev.checks.find((c) => c.key === "credits")?.status).toBe("unknown");
    expect(ev.eligibleToGraduate).toBe(false);
    expect(ev.summary.en).toMatch(/can't confirm/);
  });
  it("unreadable hold data is unknown, not 'no holds'", () => {
    const ev = evaluateReadiness("graduation", base({ holdsKnown: false }));
    expect(ev.checks.find((c) => c.key === "holds")?.status).toBe("unknown");
    expect(ev.allClear).toBe(false);
  });
  it("missing standing is unknown", () => {
    const ev = evaluateReadiness("graduation", base({ standing: null }));
    expect(ev.checks.find((c) => c.key === "standing")?.status).toBe("unknown");
  });
  it("probation blocks graduation", () => {
    expect(evaluateReadiness("graduation", base({ standing: "Academic Probation" })).blockers).toBe(1);
  });
  it("only a fully verified clean record is eligible", () => {
    const ev = evaluateReadiness("graduation", base());
    expect(ev.eligibleToGraduate).toBe(true);
  });
  it("Arabic summary for 15/120 says not eligible", () => {
    const ev = evaluateReadiness("graduation", base({ completedCredits: 15 }));
    expect(ev.summary.ar).toContain("لست مؤهلاً للتخرج");
    expect(ev.summary.ar).not.toContain("سليمة");
  });
});

describe("registration readiness", () => {
  it("remaining credits do not block registration", () => {
    const ev = evaluateReadiness("registration", base({ completedCredits: 15 }));
    expect(ev.blockers).toBe(0);
    expect(ev.allClear).toBe(true);
  });
  it("pending items prevent 'every check is clear'", () => {
    const ev = evaluateReadiness("registration", base({ openCases: [{ case_number: "X", title: "t", status: "submitted" }] }));
    expect(ev.summary.en).not.toMatch(/every check is clear/);
  });
});
