import { describe, expect, it } from "vitest";
import { lowConfidenceReviewHint, voiceTranscriptLanguage } from "./voice-channel";

describe("voice channel helpers", () => {
  it("detects Arabic vs English from transcript text", () => {
    expect(voiceTranscriptLanguage("I want to complain about the bus")).toBe("en");
    expect(voiceTranscriptLanguage("أقترح أن تتعاون الجامعة مع شركات تقنية")).toBe("ar");
  });

  it("leaves a review hint when confidence is low on a case reference", () => {
    const hint = lowConfidenceReviewHint("Is my UAEU-2026-01063 meeting confirmed?", 0.3, "en");
    expect(hint).toMatch(/UAEU-2026-01063/);
    expect(hint).toMatch(/correct/i);
  });

  it("leaves a review hint for low-confidence course codes", () => {
    const hint = lowConfidenceReviewHint("Can I register for CSBP220?", 0.2, "en");
    expect(hint).toMatch(/CSBP220/);
    expect(hint).toMatch(/course code/i);
  });

  it("skips the hint when confidence is healthy", () => {
    expect(lowConfidenceReviewHint("Can I register for CSBP220?", 0.9, "en")).toBeNull();
  });

  it("asks for review in Arabic when confidence is low", () => {
    const hint = lowConfidenceReviewHint("ما حالة الطلب UAEU-2026-01063؟", 0.25, "ar");
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/صحيح/);
  });
});
