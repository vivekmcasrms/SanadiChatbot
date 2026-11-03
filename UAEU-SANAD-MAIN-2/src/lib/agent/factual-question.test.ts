import { describe, expect, it } from "vitest";
import { detectTeachingQuestion, isGeneralKnowledgeQuestion } from "./factual-question.server";
import { isSuggestionIntent } from "./suggestion-intent.server";

describe("factual and future-looking questions", () => {
  it("A — reads a future teaching question with its year and subject", () => {
    const q = detectTeachingQuestion("Who will teach machine learning in 2030?");
    expect(q).not.toBeNull();
    expect(q?.year).toBe(2030);
    expect(q?.future).toBe(true);
    expect(q?.courseCode).toBeNull();
    expect(q?.subject).toMatch(/machine learning/i);
  });

  it("A (Arabic) — reads the same question in Arabic", () => {
    const q = detectTeachingQuestion("من سيدرّس تعلم الآلة في 2030؟");
    expect(q?.year).toBe(2030);
  });

  it("B — reads a current teaching question with the course code", () => {
    const q = detectTeachingQuestion("Who teaches CSBP220 this semester?");
    expect(q?.courseCode).toBe("CSBP220");
    expect(q?.year).toBeNull();
  });

  it("C — a personal career question is not a teaching question", () => {
    expect(detectTeachingQuestion("What jobs are suitable for me?")).toBeNull();
    expect(isGeneralKnowledgeQuestion("What jobs are suitable for me?")).toBe(false);
  });

  it("D — an improvement statement stays a suggestion", () => {
    expect(isSuggestionIntent("I think the university should offer more AI courses.")).toBe(true);
    expect(isGeneralKnowledgeQuestion("I think the university should offer more AI courses.")).toBe(false);
  });

  it("E — a complaint is neither a question nor a teaching lookup", () => {
    expect(detectTeachingQuestion("I want to complain about my AI class.")).toBeNull();
    expect(isGeneralKnowledgeQuestion("I want to complain about my AI class.")).toBe(false);
  });

  it("F — a definitional question is general knowledge", () => {
    expect(isGeneralKnowledgeQuestion("What is machine learning?")).toBe(true);
    expect(isGeneralKnowledgeQuestion("ما هو تعلم الآلة؟")).toBe(true);
    expect(detectTeachingQuestion("What is machine learning?")).toBeNull();
  });

  it("does not treat personal record questions as general knowledge", () => {
    expect(isGeneralKnowledgeQuestion("What is my GPA?")).toBe(false);
    expect(isGeneralKnowledgeQuestion("What is the status of my request?")).toBe(false);
  });
});
