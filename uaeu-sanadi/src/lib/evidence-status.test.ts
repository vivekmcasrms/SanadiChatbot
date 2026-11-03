import { describe, expect, it } from "vitest";
import { evidenceStatus, messageLang } from "./evidence-status";

describe("evidence status", () => {
  it("record-only answer never claims policy and never shows the unverified banner", () => {
    expect(evidenceStatus({ verified: false, toolsUsed: ["get_student_profile"], citations: [], hasProposals: false })).toBe("record_policy_unavailable");
  });
  it("record + policy document", () => {
    expect(evidenceStatus({ verified: true, toolsUsed: ["x"], citations: [{ documentId: "d1" }], hasProposals: false })).toBe("record_and_policy");
  });
  it("nothing checked → unverified", () => {
    expect(evidenceStatus({ verified: false, toolsUsed: [], citations: [], hasProposals: false })).toBe("unverified");
  });
});

describe("message language", () => {
  it("Arabic answer with a course code is Arabic", () => {
    expect(messageLang("أكملت 15 من 120 ساعة في CSBP 119", "en")).toBe("ar");
  });
  it("English answer under Arabic app setting is English", () => {
    expect(messageLang("You have 105 credits remaining.", "ar")).toBe("en");
  });
});
