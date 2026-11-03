import { describe, expect, it } from "vitest";
import { detectSpokenLanguage, needsVoiceConfirmation, normalizeTranscript, speakableText } from "./normalize";

describe("voice transcript normalisation", () => {
  it("rebuilds a spoken case reference", () => {
    const r = normalizeTranscript("Is my U A E U 2026 01063 meeting confirmed?");
    expect(r.text).toContain("UAEU-2026-01063");
    expect(r.reshaped).toEqual([{ kind: "case_reference", value: "UAEU-2026-01063" }]);
  });

  it("leaves an already correct case reference untouched and unflagged", () => {
    const r = normalizeTranscript("Is my UAEU-2026-01063 meeting confirmed?");
    expect(r.reshaped).toEqual([]);
    expect(needsVoiceConfirmation(r.reshaped)).toBe(false);
  });

  it("rebuilds a spelled course code with spoken digits", () => {
    const r = normalizeTranscript("Can I register for C S B P two twenty?");
    expect(r.text).toContain("CSBP220");
    expect(needsVoiceConfirmation(r.reshaped)).toBe(true);
  });

  it("joins a spaced course code", () => {
    expect(normalizeTranscript("Can I register for CSBP 220").text).toContain("CSBP220");
  });

  it("does not touch ordinary words followed by numbers", () => {
    const r = normalizeTranscript("The room 220 is closed");
    expect(r.text).toBe("The room 220 is closed");
    expect(r.reshaped).toEqual([]);
  });

  it("converts a spoken GPA", () => {
    expect(normalizeTranscript("my GPA three point two").text).toBe("my GPA 3.2");
  });

  it("detects Arabic and English", () => {
    expect(detectSpokenLanguage("أقترح أن تتعاون الجامعة مع شركات تقنية أكثر")).toBe("ar");
    expect(detectSpokenLanguage("I want to complain about the evening bus")).toBe("en");
  });

  it("strips links and markdown before speaking", () => {
    expect(speakableText("**Done.** See [here](https://x.y/z)")).toBe("Done. See here");
  });
});
