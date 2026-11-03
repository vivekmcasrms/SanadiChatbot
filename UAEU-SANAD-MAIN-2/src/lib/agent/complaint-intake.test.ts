import { describe, expect, it } from "vitest";
import { detectComplaintOpening, isComplaintDetailReply } from "./complaint-intake.server";

describe("complaint opening detection", () => {
  it("captures the subject from the opening message", () => {
    const hit = detectComplaintOpening("I want to complain about the evening bus service");
    expect(hit).not.toBeNull();
    expect(hit!.subject).toBe("the evening bus service");
  });

  it("works in Arabic", () => {
    const hit = detectComplaintOpening("أريد تقديم شكوى بخصوص خدمة الحافلات المسائية");
    expect(hit).not.toBeNull();
    expect(hit!.subject).toContain("الحافلات");
  });

  it("ignores questions and suggestions", () => {
    expect(detectComplaintOpening("When does the evening bus leave?")).toBeNull();
    expect(detectComplaintOpening("It would be helpful if buses ran later")).toBeNull();
  });

  it("treats short acknowledgements as non-detail", () => {
    expect(isComplaintDetailReply("ok")).toBe(false);
    expect(isComplaintDetailReply("The bus did not arrive at 8pm yesterday")).toBe(true);
  });

  it("never files unrelated questions or requests as complaint detail", () => {
    expect(isComplaintDetailReply("what's my GPA?")).toBe(false);
    expect(isComplaintDetailReply("What is my GPA")).toBe(false);
    expect(isComplaintDetailReply("كم معدلي؟")).toBe(false);
    expect(isComplaintDetailReply("I need a to whom it may concern letter")).toBe(false);
    expect(isComplaintDetailReply("book an appointment with the advisor")).toBe(false);
    expect(isComplaintDetailReply("لم تصل الحافلة أمس الساعة الثامنة مساءً من البوابة الشمالية")).toBe(true);
  });

});
