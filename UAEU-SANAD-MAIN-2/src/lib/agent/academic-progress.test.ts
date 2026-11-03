import { describe, expect, it } from "vitest";
import {
  computeDegreeProgress,
  detectAcademicProgressIntent,
} from "./academic-progress.server";
import type { StudentSnapshot } from "../student-context.server";
import type { AcademicCourses } from "../academic-record.server";

describe("Academic Progress Agent — intent detection", () => {
  const cases: [string, string][] = [
    ["How many credits have I completed?", "credits_completed"],
    ["How many credits do I have left?", "credits_remaining"],
    ["What courses have I completed?", "courses_completed"],
    ["What courses am I currently taking?", "courses_current"],
    ["What courses do I still need?", "courses_remaining"],
    ["Am I on track to graduate?", "graduation"],
    ["What should I focus on academically?", "focus"],
    ["Show my academic progress", "overview"],
    ["كم ساعة أكملت؟", "credits_completed"],
    ["كم ساعة باقي لي؟", "credits_remaining"],
    ["ما هي المواد المتبقية؟", "courses_remaining"],
    ["ما هي المواد المسجلة هذا الفصل؟", "courses_current"],
    ["هل أنا جاهز للتخرج؟", "graduation"],
    ["ما هو تقدمي الأكاديمي؟", "overview"],
  ];
  for (const [text, expected] of cases) {
    it(`routes "${text}" to ${expected}`, () => {
      expect(detectAcademicProgressIntent(text)).toBe(expected);
    });
  }

  it("ignores unrelated questions", () => {
    expect(detectAcademicProgressIntent("The buses are always late")).toBeNull();
    expect(detectAcademicProgressIntent("Find me a book about machine learning")).toBeNull();
    expect(detectAcademicProgressIntent("كيف أطلب تصريح دخول للجامعة؟")).toBeNull();
  });
});

const snapshot = (over: Partial<StudentSnapshot> = {}): StudentSnapshot =>
  ({
    hasProfile: true,
    completedCredits: 90,
    registeredCredits: 15,
    totalCredits: 120,
    expectedGraduation: null,
    holds: [],
    requirements: [],
    ...over,
  }) as StudentSnapshot;

const courses = (over: Partial<AcademicCourses> = {}): AcademicCourses => ({
  completed: [],
  current: [],
  remaining: [],
  baskets: [],
  completedCreditHours: 0,
  currentCreditHours: 0,
  fixedRemainingCreditHours: 0,
  basketRemainingCreditHours: 0,
  remainingCreditHours: 0,
  programCourseCount: 0,
  ...over,
});


describe("Academic Progress Agent — deterministic maths", () => {
  it("derives remaining credits from the study plan when it exists", () => {
    const p = computeDegreeProgress(
      snapshot(),
      courses({ programCourseCount: 40, remainingCreditHours: 24 }),
    );
    expect(p.remainingCredits).toBe(24);
    expect(p.remainingAfterCurrentTerm).toBe(9);
    expect(p.percentComplete).toBe(75);
    expect(p.estimatedTermsLeft).toBe(1);
  });

  it("falls back to programme credit totals when no plan is registered", () => {
    const p = computeDegreeProgress(snapshot({ completedCredits: 60 }), courses());
    expect(p.remainingCredits).toBe(60);
    expect(p.percentComplete).toBe(50);
  });

  it("never returns a negative remainder", () => {
    const p = computeDegreeProgress(snapshot({ completedCredits: 130 }), courses());
    expect(p.remainingCredits).toBe(0);
    expect(p.estimatedTermsLeft).toBe(0);
  });

  it("flags an off-track student against the expected graduation date", () => {
    const soon = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 10);
    const p = computeDegreeProgress(
      snapshot({ completedCredits: 30, registeredCredits: 12, expectedGraduation: soon }),
      courses(),
    );
    expect(p.onTrack).toBe(false);
  });
});
