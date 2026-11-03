import { describe, expect, it } from "vitest";
import { isSuggestionIntent } from "./suggestion-intent.server";
import { detectCareerChatTopic } from "../career/chat.server";

describe("isSuggestionIntent", () => {
  it("detects the reported career counselling hours suggestion", () => {
    expect(
      isSuggestionIntent(
        "It would be helpful if career counselling stayed open later during recruitment season.",
      ),
    ).toBe(true);
  });

  it("detects common English suggestion framings", () => {
    expect(isSuggestionIntent("It would be nice if the library opened earlier.")).toBe(true);
    expect(isSuggestionIntent("I suggest you offer weekend advising hours.")).toBe(true);
    expect(
      isSuggestionIntent("You should extend the appointment booking window to two weeks."),
    ).toBe(true);
    expect(isSuggestionIntent("Why doesn't the university offer online advising?")).toBe(true);
    expect(isSuggestionIntent("Please consider adding more parking spaces.")).toBe(true);
    expect(isSuggestionIntent("I have a suggestion about the student portal.")).toBe(true);
  });

  it("detects Arabic suggestion framings", () => {
    expect(isSuggestionIntent("أقترح تمديد دوام الإرشاد المهني في موسم التوظيف")).toBe(true);
    expect(isSuggestionIntent("يا ليت المكتبة تفتح يوم السبت")).toBe(true);
    expect(isSuggestionIntent("لماذا لا توفرون مراجعة سيرة ذاتية عن بعد؟")).toBe(true);
  });

  it("rejects genuine service questions even when they contain domain words", () => {
    expect(isSuggestionIntent("When does career counselling close?")).toBe(false);
    expect(isSuggestionIntent("What is my ATS score?")).toBe(false);
    expect(isSuggestionIntent("Book me a career counselling appointment")).toBe(false);
    expect(isSuggestionIntent("How do I apply for an internship?")).toBe(false);
  });

  it("rejects personal requests that borrow suggestion phrasing", () => {
    expect(isSuggestionIntent("Can you help me with my registration?")).toBe(false);
    expect(isSuggestionIntent("It would be helpful if you could fix my hold")).toBe(false);
  });

  it("rejects empty and nullish input", () => {
    expect(isSuggestionIntent("")).toBe(false);
  });
});

describe("suggestion vs career routing", () => {
  it("the career topic detector still sees the domain word, so the suggestion check must run first", () => {
    // Documents the original failure: bare "career" matches the matches topic.
    expect(
      detectCareerChatTopic(
        "It would be helpful if career counselling stayed open later during recruitment season.",
      ),
    ).not.toBeNull();
  });

  it("real career questions are not misread as suggestions", () => {
    expect(isSuggestionIntent("Which jobs match my degree?")).toBe(false);
    expect(isSuggestionIntent("What skills am I missing?")).toBe(false);
    expect(isSuggestionIntent("Review my CV")).toBe(false);
  });
});

describe("university improvement suggestions vs personal career requests", () => {
  it("treats institutional improvement framing as a suggestion", () => {
    expect(
      isSuggestionIntent(
        "I think the university should build stronger partnerships with technology companies so students can get better internship and employment opportunities.",
      ),
    ).toBe(true);
    expect(isSuggestionIntent("I suggest the university organise more career fairs.")).toBe(true);
    expect(isSuggestionIntent("We need stronger industry partnerships.")).toBe(true);
    expect(isSuggestionIntent("The university should create more internship opportunities.")).toBe(true);
    expect(
      isSuggestionIntent("أقترح أن تتعاون الجامعة مع شركات تقنية أكثر لتوفير فرص تدريب للطلبة."),
    ).toBe(true);
    expect(isSuggestionIntent("أعتقد أن الجامعة يجب أن تزيد الشراكات مع الشركات")).toBe(true);
  });

  it("keeps personal career requests out of the suggestion path", () => {
    expect(isSuggestionIntent("What jobs can I apply for after graduation?")).toBe(false);
    expect(isSuggestionIntent("Can you review my CV for technology companies?")).toBe(false);
    expect(isSuggestionIntent("Help me prepare for an interview.")).toBe(false);
  });
});
