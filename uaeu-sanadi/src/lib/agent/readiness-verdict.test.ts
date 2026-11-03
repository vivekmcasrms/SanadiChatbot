import { describe, expect, it } from "vitest";
import { readinessVerdict, statusLabel, statusOf, verdictHeading, type CheckState } from "./readiness-verdict";

const base = (over: Partial<Record<string, CheckState>> = {}) =>
  Object.entries({
    enrollment: "pass",
    window: "pass",
    holds: "pass",
    standing: "pass",
    prerequisites: "pass",
    timetable: "pass",
    credits: "pass",
    service: "pass",
    ...over,
  }).map(([key, state]) => ({ key, state: state as CheckState }));

describe("registration readiness verdict", () => {
  it("all pass → verified", () => {
    const v = readinessVerdict(base());
    expect(v.verified).toBe(true);
    expect(v.outcome).toBe("ready");
  });

  it("not applicable counts as satisfied", () => {
    expect(readinessVerdict(base({ timetable: "not_applicable" })).verified).toBe(true);
  });

  it("one unknown → not verified, unable to verify", () => {
    const v = readinessVerdict(base({ standing: "unknown" }));
    expect(v.verified).toBe(false);
    expect(v.outcome).toBe("unable_to_verify");
    expect(v.unknown).toBe(1);
  });

  it("multiple unknown → not verified", () => {
    const v = readinessVerdict(base({ standing: "unknown", prerequisites: "unknown", credits: "unknown" }));
    expect(v.verified).toBe(false);
    expect(v.unknown).toBe(3);
  });

  it("one fail → not verified, requires attention", () => {
    const v = readinessVerdict(base({ holds: "blocked" }));
    expect(v.verified).toBe(false);
    expect(v.outcome).toBe("action_required");
  });

  it("service unavailable → not verified", () => {
    expect(readinessVerdict(base({ service: "blocked" })).verified).toBe(false);
    expect(readinessVerdict(base({ service: "unknown" })).verified).toBe(false);
  });

  it("missing registration window → not verified", () => {
    expect(readinessVerdict(base({ window: "unknown" })).verified).toBe(false);
  });

  it("missing hold information → not verified", () => {
    expect(readinessVerdict(base({ holds: "unknown" })).verified).toBe(false);
  });

  it("no checks at all is never verified", () => {
    expect(readinessVerdict([]).verified).toBe(false);
  });

  it("advisory warnings do not block", () => {
    expect(readinessVerdict(base({ timetable: "warning" })).verified).toBe(true);
  });

  it("wording: Verified / Unable to verify / Requires attention", () => {
    expect(statusLabel(statusOf("pass"), "en")).toBe("Verified");
    expect(statusLabel(statusOf("unknown"), "en")).toBe("Unable to verify");
    expect(statusLabel(statusOf("blocked"), "en")).toBe("Requires attention");
  });

  it("Arabic equivalents", () => {
    expect(statusLabel("PASS", "ar")).toBe("تم التحقق");
    expect(statusLabel("UNKNOWN", "ar")).toBe("تعذّر التحقق");
    expect(statusLabel("FAIL", "ar")).toBe("يتطلب إجراء");
    const heading = verdictHeading(readinessVerdict(base({ holds: "unknown" })), "ar");
    expect(heading).toContain("تعذّر التحقق");
    expect(heading).not.toContain("جاهز للتسجيل");
  });

  it("an unknown check never produces the ready heading", () => {
    const h = verdictHeading(readinessVerdict(base({ prerequisites: "unknown" })), "en");
    expect(h).not.toMatch(/ready to register|everything is clear/i);
  });
});
