import { describe, expect, it } from "vitest";
import {
  isCampusEntryPermitQuestion,
  isCampusAccessProblem,
  proactiveCampusEntryAnswer,
  campusAccessProblemAnswer,
} from "./proactive-services.server";

describe("proactive campus entry", () => {
  it("matches English entry permit questions", () => {
    for (const q of [
      "Do I need an entry permit to campus?",
      "How do I request a parking permit?",
      "How can I get vehicle access to the university?",
      "I need gate access for my car",
    ])
      expect(isCampusEntryPermitQuestion(q)).toBe(true);
  });

  it("matches Arabic entry permit questions", () => {
    expect(isCampusEntryPermitQuestion("كيف أطلب تصريح دخول للجامعة؟")).toBe(true);
    expect(isCampusEntryPermitQuestion("تصريح المواقف كيف أحصل عليه؟")).toBe(true);
  });

  it("ignores unrelated questions", () => {
    for (const q of ["What time does the library close?", "Why can't I register for courses?", "There is a fire in building F"])
      expect(isCampusEntryPermitQuestion(q)).toBe(false);
  });

  it("answers in the student's language with a warm proactive tone", () => {
    expect(proactiveCampusEntryAnswer("en")).toContain("Good news");
    expect(proactiveCampusEntryAnswer("en")).toContain("you're all set");
    expect(proactiveCampusEntryAnswer("ar")).toContain("خبر سار");
    expect(proactiveCampusEntryAnswer("ar")).toContain("كل شيء جاهز لك");
  });

  it("tells the student no request or approval is needed", () => {
    expect(proactiveCampusEntryAnswer("en")).toContain("no longer need to submit a separate request");
    expect(proactiveCampusEntryAnswer("ar")).toContain("طلب منفصل");
  });

  it("detects campus access problems", () => {
    expect(isCampusAccessProblem("My UAEU ID is not opening the gate")).toBe(true);
    expect(isCampusAccessProblem("The parking gate won't open for my car")).toBe(true);
    expect(isCampusAccessProblem("بطاقتي الجامعية لا تفتح البوابة")).toBe(true);
    expect(isCampusAccessProblem("Do I need an entry permit?")).toBe(false);
    expect(isCampusAccessProblem("What time does the library close?")).toBe(false);
  });

  it("answers access problems in the student's language", () => {
    expect(campusAccessProblemAnswer("en")).toContain("Security Office");
    expect(campusAccessProblemAnswer("en")).toContain("report this to the Security team");
    expect(campusAccessProblemAnswer("ar")).toContain("مكتب الأمن");
    expect(campusAccessProblemAnswer("ar")).toContain("أبلّغ فريق الأمن");
  });
});
