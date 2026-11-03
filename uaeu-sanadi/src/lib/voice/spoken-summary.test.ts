import { describe, expect, it } from "vitest";
import { isEndVoiceCommand, spokenSummary } from "./spoken-summary";

describe("spoken summary", () => {
  it("speaks a short answer in full", () => {
    const a = "Yes. Your meeting is confirmed for Tuesday at 2 PM.";
    expect(spokenSummary({ answer: a, lang: "en" })).toBe(a);
  });

  it("speaks only the conclusion of a structured record and points to the screen", () => {
    const a = [
      "You are in good standing with a GPA of 3.42 and 78 completed credits.",
      "",
      "**Programme:** BSc Data Science",
      "- CSBP220 — A",
      "- CSBP320 — B+",
      "- STAT210 — A-",
    ].join("\n");
    const s = spokenSummary({ answer: a, lang: "en" });
    expect(s).toContain("GPA of 3.42");
    expect(s).not.toContain("CSBP220");
    expect(s).toContain("displayed the full details below");
  });

  it("asks for on-screen confirmation instead of reading an approval", () => {
    const s = spokenSummary({ answer: "I've prepared your complaint.", lang: "en", hasPendingAction: true });
    expect(s).toContain("confirm the action shown below");
  });

  it("uses Arabic screen phrasing for Arabic answers", () => {
    const a = "معدلك 3.42.\n- مقرر 1\n- مقرر 2";
    expect(spokenSummary({ answer: a, lang: "ar" })).toContain("تحت الرد");
  });

  it("recognises end commands in both languages", () => {
    expect(isEndVoiceCommand("Stop.")).toBe(true);
    expect(isEndVoiceCommand("توقف")).toBe(true);
    expect(isEndVoiceCommand("Stop the bus complaint")).toBe(false);
  });
});
