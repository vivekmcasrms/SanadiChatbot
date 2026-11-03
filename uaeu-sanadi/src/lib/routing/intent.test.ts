import { describe, expect, it } from "vitest";
import { parseClassifierOutput } from "./classifier.server";
import { heuristicClassify, liveSticky, nextSticky, resolveRoute, STICKY_TTL_MS, type StickyContext } from "./intent";
import { ROUTING_REGRESSION_SET } from "./regression-set";

const NOW = new Date("2026-10-28T18:00:00Z");
const fresh = (min = 1) => new Date(NOW.getTime() - min * 60_000).toISOString();
const stickyOf = (k?: keyof typeof STICKY_TTL_MS): StickyContext =>
  k ? { [k]: { value: k === "activeCase" ? "UAEU-2026-01063" : "active", at: fresh() } } : {};

describe("regression set", () => {
  it("has at least 200 phrases across all four language styles", () => {
    expect(ROUTING_REGRESSION_SET.length).toBeGreaterThanOrEqual(200);
    for (const l of ["en", "ar", "ae", "mix"]) expect(ROUTING_REGRESSION_SET.some((r) => r.lang === l)).toBe(true);
  });

  it("every difficult example routes correctly", () => {
    for (const r of ROUTING_REGRESSION_SET.filter((x) => x.hard)) {
      const d = resolveRoute({ text: r.text, sticky: stickyOf(r.sticky), now: NOW });
      expect(d.intent, r.text).toBe(r.expected);
    }
  });

  it("offline fallback routes at least 90% of the set correctly", () => {
    const misses = ROUTING_REGRESSION_SET.filter(
      (r) => resolveRoute({ text: r.text, sticky: stickyOf(r.sticky), now: NOW }).intent !== r.expected,
    );
    const accuracy = 1 - misses.length / ROUTING_REGRESSION_SET.length;
    if (accuracy < 0.9) console.log(misses.map((m) => `${m.expected} <- ${m.text}`).join("\n"));
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});

describe("deterministic priorities", () => {
  it("a case reference beats every other meaning", () => {
    const d = resolveRoute({ text: "I want to transfer, what about UAEU-2026-01063?", now: NOW });
    expect(d.intent).toBe("existing_case_followup");
    expect(d.case_reference).toBe("UAEU-2026-01063");
  });
  it("a case reference beats a confident semantic label", () => {
    const d = resolveRoute({ text: "Is UAEU-2026-01063 confirmed?", semantic: { intent: "hostel_booking", confidence: 0.95 }, now: NOW });
    expect(d.intent).toBe("existing_case_followup");
  });
  it("unmistakable emergencies route to alert", () => {
    expect(resolveRoute({ text: "There is a fire in the hostel", now: NOW }).intent).toBe("alert");
  });
  it("'urgent' alone is not an emergency", () => {
    expect(resolveRoute({ text: "I need an urgent enrolment letter", now: NOW }).intent).toBe("service_request");
  });
});

describe("no routing on a bare topic word", () => {
  for (const w of ["job", "internship", "hostel", "transfer", "library", "registration"]) {
    it(`"${w}" alone is not a confident service route`, () => {
      const h = heuristicClassify(w);
      expect(h.confidence).toBeLessThan(0.7);
    });
  }
});

describe("sticky context", () => {
  it("expires after its TTL", () => {
    const old = new Date(NOW.getTime() - STICKY_TTL_MS.transferTarget - 1000).toISOString();
    expect(liveSticky({ transferTarget: { value: "BSCS", at: old } }, NOW.getTime())).toEqual({});
    const d = resolveRoute({ text: "and the credits?", sticky: { transferTarget: { value: "BSCS", at: old } }, now: NOW });
    expect(d.intent).not.toBe("program_transfer");
  });
  it("continues a live flow on a short follow-up", () => {
    expect(resolveRoute({ text: "and the credits?", sticky: stickyOf("transferTarget"), now: NOW }).intent).toBe("program_transfer");
  });
  it("never overrides an obvious topic change", () => {
    const d = resolveRoute({ text: "I want to book a hostel room", sticky: stickyOf("transferTarget"), now: NOW });
    expect(d.intent).toBe("hostel_booking");
    expect(d.topic_changed).toBe(true);
  });
  it("case follow-up without a reference uses the active case", () => {
    const d = resolveRoute({ text: "شو status مال طلبي؟", sticky: stickyOf("activeCase"), now: NOW });
    expect(d.case_reference).toBe("UAEU-2026-01063");
  });
  it("nextSticky refreshes, clears and expires entries", () => {
    const old = new Date(NOW.getTime() - STICKY_TTL_MS.hostelFlow - 1).toISOString();
    const n = nextSticky({ hostelFlow: { value: "active", at: old }, careerDomain: { value: "cv", at: fresh() } }, { transferTarget: "BSCS", careerDomain: null }, NOW);
    expect(Object.keys(n)).toEqual(["transferTarget"]);
  });
});

describe("semantic classifier contract", () => {
  it("low confidence produces exactly one short clarification", () => {
    const d = resolveRoute({ text: "hmm about that thing", semantic: { intent: "general_query", confidence: 0.3 }, now: NOW });
    expect(d.clarification?.en).toMatch(/\?$/);
    expect(d.clarification?.en.split("?").length).toBe(2);
  });
  it("a generic semantic label does not hide a clear service request", () => {
    expect(resolveRoute({ text: "أبغي أحول تخصصي", semantic: { intent: "general_query", confidence: 0.6 }, now: NOW }).intent).toBe("program_transfer");
  });
  it("a confident semantic suggestion wins over career words", () => {
    expect(resolveRoute({ text: "More companies should hire our graduates", semantic: { intent: "suggestion", confidence: 0.9 }, now: NOW }).intent).toBe("suggestion");
  });
  it("rejects labels outside the fixed list", () => {
    expect(parseClassifierOutput('{"intent":"approve_transfer","confidence":0.99}')).toBeNull();
    expect(parseClassifierOutput('noise {"intent":"complaint","confidence":2} tail')).toEqual({ intent: "complaint", confidence: 1 });
  });
});
