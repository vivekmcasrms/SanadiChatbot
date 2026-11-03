import { describe, expect, it } from "vitest";
import { detectCareerChatTopic } from "./chat.server";

describe("career chat intent detection", () => {
  const cases: [string, string][] = [
    ["What is my ATS score?", "ats"],
    ["Review my CV", "cv_review"],
    ["How can I improve my CV?", "cv_review"],
    ["What skills am I missing?", "skill_gap"],
    ["What should I learn next?", "skill_gap"],
    ["Which jobs match my CV?", "matches"],
    ["ما هي درجة سيرتي الذاتية في أنظمة الفرز؟", "ats"],
    ["ما المهارات الناقصة لدي؟", "skill_gap"],
  ];

  it.each(cases)("routes %s to the %s topic", (text, topic) => {
    expect(detectCareerChatTopic(text)).toBe(topic);
  });

  it("leaves unrelated questions to the normal agent loop", () => {
    expect(detectCareerChatTopic("When does registration open?")).toBeNull();
  });
});
