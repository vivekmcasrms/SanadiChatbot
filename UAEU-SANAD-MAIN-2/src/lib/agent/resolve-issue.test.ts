import { describe, expect, it } from "vitest";
import { detectResolveIssueIntent, planAgents } from "./resolve-issue.server";

describe("resolve-this-for-me intent", () => {
  it("claims problem statements and routes them to a topic", () => {
    expect(detectResolveIssueIntent("I can't register")).toBe("registration");
    expect(detectResolveIssueIntent("I don't know what I need to graduate")).toBe("graduation");
    expect(detectResolveIssueIntent("I need help with my career")).toBe("career");
    expect(detectResolveIssueIntent("I have a problem and don't know who to contact")).toBe("contact");
  });

  it("works in Arabic", () => {
    expect(detectResolveIssueIntent("لا أستطيع التسجيل")).toBe("registration");
    expect(detectResolveIssueIntent("ما أعرف وش أحتاج للتخرج")).toBe("graduation");
    expect(detectResolveIssueIntent("عندي مشكلة وما أعرف مين أراجع")).toBe("contact");
  });

  it("leaves plain factual questions to the specialised agents", () => {
    expect(detectResolveIssueIntent("When does registration open?")).toBeNull();
    expect(detectResolveIssueIntent("How many credits have I completed?")).toBeNull();
    expect(detectResolveIssueIntent("متى تبدأ فترة التسجيل؟")).toBeNull();
  });
});

describe("agent selection", () => {
  it("selects only the agents a topic needs", () => {
    expect(planAgents("registration")).toEqual([
      "hold_resolution",
      "registration_readiness",
      "academic_progress",
    ]);
    expect(planAgents("graduation")).toEqual(["academic_progress", "hold_resolution"]);
    expect(planAgents("career")).toEqual(["career", "academic_progress"]);
    expect(planAgents("general")).toEqual(["hold_resolution", "registration_readiness"]);
  });

  it("never fans out to every agent", () => {
    for (const t of ["registration", "graduation", "career", "contact", "general"] as const) {
      expect(planAgents(t).length).toBeLessThanOrEqual(3);
    }
  });
});
