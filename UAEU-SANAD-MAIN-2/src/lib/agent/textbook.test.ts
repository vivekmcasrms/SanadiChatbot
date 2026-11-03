import { describe, expect, it } from "vitest";
import {
  detectTextbookIntent,
  resolveEnrolledCourse,
  proactiveTextbookAnswer,
  type EnrolledCourse,
} from "./textbook.server";

const COURSES: EnrolledCourse[] = [
  { code: "STAT210", titleEn: "Probability and Statistics", titleAr: "الاحتمالات والإحصاء" },
  { code: "MATH110", titleEn: "Calculus II", titleAr: "التفاضل والتكامل ٢" },
  { code: "CSBP219", titleEn: "Object Oriented Programming", titleAr: "البرمجة كائنية التوجه" },
  { code: "CSBP270", titleEn: "Responsible Artificial Intelligence", titleAr: "الذكاء الاصطناعي المسؤول" },
  { code: "MATH140", titleEn: "Linear Algebra I", titleAr: "الجبر الخطي ١" },
];

describe("course textbook intent", () => {
  it("matches English and Arabic textbook questions", () => {
    expect(detectTextbookIntent("Where can I get the textbook for my course?")).toBe(true);
    expect(detectTextbookIntent("Where is my textbook for CSBP219?")).toBe(true);
    expect(detectTextbookIntent("Do I have the textbook for my AI course?")).toBe(true);
    expect(detectTextbookIntent("أين أجد كتاب مقرر MATH110؟")).toBe(true);
  });

  it("does not match plain library searches", () => {
    expect(detectTextbookIntent("Find me a good book on deep learning")).toBe(false);
    expect(detectTextbookIntent("Book me an appointment")).toBe(false);
  });
});

describe("resolveEnrolledCourse", () => {
  it("resolves an exact course code", () => {
    expect(resolveEnrolledCourse("STAT210", COURSES)?.code).toBe("STAT210");
    expect(resolveEnrolledCourse("where is my textbook for CSBP219?", COURSES)?.code).toBe("CSBP219");
    expect(resolveEnrolledCourse("stat 210", COURSES)?.code).toBe("STAT210");
  });

  it("resolves a title description", () => {
    expect(resolveEnrolledCourse("my AI course", COURSES)?.code).toBe("CSBP270");
    expect(resolveEnrolledCourse("the probability course", COURSES)?.code).toBe("STAT210");
  });

  it("returns null when nothing matches", () => {
    expect(resolveEnrolledCourse("hello there", COURSES)).toBeNull();
  });
});

describe("proactiveTextbookAnswer", () => {
  it("is short, positive and names the course and Blackboard", () => {
    const en = proactiveTextbookAnswer(COURSES[0]!, "en");
    expect(en).toContain("Good news");
    expect(en).toContain("STAT210");
    expect(en).toContain("Blackboard");
    expect(en).toContain("No separate request is needed");
    expect(en).not.toContain("catalogue");
    expect(en).not.toContain("borrow");
    expect(en.split("\n").length).toBeLessThanOrEqual(7);
  });

  it("has an Arabic equivalent", () => {
    const ar = proactiveTextbookAnswer(COURSES[2]!, "ar");
    expect(ar).toContain("خبر سار");
    expect(ar).toContain("CSBP219");
    expect(ar).toContain("Blackboard");
    expect(ar).toContain("لا تحتاج إلى تقديم أي طلب منفصل");
  });
});
