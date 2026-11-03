import { describe, expect, it } from "vitest";
import {
  classifyVoiceTurn,
  forSpeakingHighlights,
  isPersonalChatRefusal,
  isVoiceSmallTalk,
  planVoiceReply,
  recognizerLanguageMismatch,
  studentGivenName,
} from "./voice-agent";

const mira = { agent: "mira" as const, studentName: "Ahmed", introduced: false, ackVariant: 0 };
const suhail = { agent: "suhail" as const, studentName: "أحمد", introduced: false, ackVariant: 0 };

describe("voice greeting classification", () => {
  it("recognizes English greetings without calling business logic", () => {
    for (const said of ["Hi", "HELLO!", "Hey there", "Good morning", "How are you?", "helo", "Salam"]) {
      const turn = classifyVoiceTurn(said);
      expect(turn.callBusiness, said).toBe(false);
      expect(turn.original).toBe(said);
    }
    expect(classifyVoiceTurn("Hello Mira, how are you?").intent).toBe("GREETING_ONLY");
    expect(classifyVoiceTurn("Hello how are you").callBusiness).toBe(false);
    expect(classifyVoiceTurn("Hello, how are you?").intent).toBe("GREETING_ONLY");
    expect(classifyVoiceTurn("Hello how are you doing today").callBusiness).toBe(false);
    expect(isVoiceSmallTalk("Hello how are you")).toBe(true);
    expect(isVoiceSmallTalk("Hello, who are you?")).toBe(true);
    expect(isVoiceSmallTalk("What is my name?")).toBe(false);
    expect(classifyVoiceTurn("What is my GPA?").callBusiness).toBe(true);
    expect(classifyVoiceTurn("Where can I find the textbook for HIST120?").callBusiness).toBe(true);
    expect(isPersonalChatRefusal("I could not find an academic record linked to your account, so I cannot verify your personal data.")).toBe(true);
    expect(isPersonalChatRefusal("I can't answer personal questions.")).toBe(true);
    expect(classifyVoiceTurn("Salam").language).toBe("ar");
    expect(classifyVoiceTurn("Shlonak").language).toBe("ar");
  });

  it("recognizes Arabic and Emirati greetings", () => {
    for (const said of [
      "مرحبا", "السلام عليكم", "صباح الخير", "شحالك؟", "هلا والله", "وعليكم السلام",
      "مرحباً، كيف حالك اليوم؟", "هلا ميرا شخبارك", "أهلاً يا سهيل، كيف الحال؟", "صباح الخير، كيف الأمور؟", "حياك الله",
    ]) {
      const turn = classifyVoiceTurn(said);
      expect(turn.language, said).toBe("ar");
      expect(turn.intent, said).toBe("GREETING_ONLY");
      expect(turn.callBusiness, said).toBe(false);
    }
  });

  it("treats Arabic heard by an English recognizer as an Arabic greeting", () => {
    for (const said of ["Marhaba kaif halak", "Salam alaikum", "Assalamu alaikum ya Mira", "marhabah shlonak"]) {
      const turn = classifyVoiceTurn(said);
      expect(turn.language, said).toBe("ar");
      expect(turn.intent, said).toBe("GREETING_ONLY");
    }
    const plan = planVoiceReply(classifyVoiceTurn("Marhaba kaif halak"), suhail);
    expect(plan.language).toBe("ar");
    expect(plan.speech).toContain("سهيل");
    expect(plan.speech).toContain("بخير");
  });

  it("keeps a greeting plus a question as the original request", () => {
    const said = "Hello Mira, how are you? Can you create my enrolment letter?";
    const turn = classifyVoiceTurn(said);
    expect(turn.intent).toBe("GREETING_WITH_QUESTION");
    expect(turn.callBusiness).toBe(true);
    expect(turn.original).toBe(said);
    expect(turn.greeting).toBe(true);
  });

  it("does not treat a schedule question as small talk", () => {
    const said = "Good morning, what is my class schedule?";
    const turn = classifyVoiceTurn(said);
    expect(turn.intent).toBe("GREETING_WITH_QUESTION");
    expect(turn.original).toBe(said);
  });

  it("counts two requests without dropping either", () => {
    const said = "Hi Suhail, how are you? Can you tell me my attendance and also help me find my course textbook?";
    const turn = classifyVoiceTurn(said);
    expect(turn.intent).toBe("MULTIPLE_QUESTIONS");
    expect(turn.requestCount).toBeGreaterThan(1);
    expect(turn.original).toBe(said);
  });

  it("processes a bare question with no greeting", () => {
    const turn = classifyVoiceTurn("Can you tell me my attendance percentage?");
    expect(turn.intent).toBe("QUESTION_ONLY");
    expect(turn.greeting).toBe(false);
    expect(turn.callBusiness).toBe(true);
  });

  it("handles thanks, farewell, and a follow-up without a business call", () => {
    expect(classifyVoiceTurn("Thanks, Mira.").intent).toBe("THANK_YOU");
    expect(classifyVoiceTurn("Actually, I have another question.").intent).toBe("FOLLOW_UP");
    expect(classifyVoiceTurn("مع السلامة").intent).toBe("FAREWELL");
    expect(classifyVoiceTurn("Thanks, Mira.").callBusiness).toBe(false);
  });

  it("detects when the recognizer heard the other language", () => {
    // English recognizer hearing Arabic speech: low confidence, no everyday English words.
    expect(recognizerLanguageMismatch("abhi if adat as jeel", "en", null)).toBe("ar");
    // Function words alone do not make it English, even at high confidence.
    expect(recognizerLanguageMismatch("my habit", "en", 0.85)).toBe("ar");
    expect(recognizerLanguageMismatch("sub hunger", "en", 0.85)).toBe("ar");
    // A near-miss of an Arabic greeting is answered directly as one, not bounced.
    for (const heard of ["mark haba cave Halik", "a salami come", "Saba al hair"]) {
      expect(recognizerLanguageMismatch(heard, "en", 0.31), heard).toBeNull();
      expect(classifyVoiceTurn(heard).language, heard).toBe("ar");
      expect(classifyVoiceTurn(heard).intent, heard).toBe("GREETING_ONLY");
    }
    // Real English keeps the English recognizer, even at low confidence.
    expect(recognizerLanguageMismatch("where is the library", "en", 0.4)).toBeNull();
    expect(recognizerLanguageMismatch("Hello how are you", "en", 0.9)).toBeNull();
    // Arabizi greetings are answered, not bounced.
    expect(recognizerLanguageMismatch("Marhaba kaif halak", "en", 0.3)).toBeNull();
    // Arabic recognizer hearing English speech.
    expect(recognizerLanguageMismatch("وير از ذا لايبراري", "ar", 0.35)).toBe("en");
    expect(recognizerLanguageMismatch("وين المكتبة", "ar", 0.35)).toBeNull();
    expect(recognizerLanguageMismatch("السلام عليكم", "ar", 0.9)).toBeNull();
  });

  it("switches language from the latest utterance", () => {
    expect(classifyVoiceTurn("السلام عليكم", "en").language).toBe("ar");
    expect(classifyVoiceTurn("Hello again", "ar").language).toBe("en");
  });
});

describe("voice reply plan", () => {
  it("greets in English with the student name and Mira", () => {
    const plan = planVoiceReply(classifyVoiceTurn("Hello Mira, how are you?"), mira);
    expect(plan.callBusiness).toBe(false);
    expect(plan.speech).toContain("Ahmed");
    expect(plan.speech).toContain("Mira");
    expect(plan.speech).toContain("doing well");
    expect(plan.keepListening).toBe(true);
  });

  it("greets in Emirati Arabic as Suhail", () => {
    const plan = planVoiceReply(classifyVoiceTurn("السلام عليكم يا سهيل، شحالك؟"), suhail);
    expect(plan.language).toBe("ar");
    expect(plan.speech).toContain("سهيل");
    expect(plan.speech).toContain("أحمد");
    expect(plan.callBusiness).toBe(false);
  });

  it("acknowledges a greeting plus a question before business processing", () => {
    const plan = planVoiceReply(classifyVoiceTurn("Hello Mira, how are you? Can you create my enrolment letter?"), mira);
    expect(plan.callBusiness).toBe(true);
    expect(plan.speech).toContain("Ahmed");
    expect(plan.speech.toLowerCase()).toContain("enrolment");
  });

  it("does not invent a name", () => {
    expect(studentGivenName(null)).toBeNull();
    expect(studentGivenName("a@uaeu.ac.ae")).toBeNull();
    const plan = planVoiceReply(classifyVoiceTurn("Hi"), { ...mira, studentName: null });
    expect(plan.speech).not.toContain("Ahmed");
    expect(plan.speech).toContain("Mira");
  });

  it("reads key values from a long answer instead of the full layout", () => {
    const answer =
      "✅ **Good news!** Here is your academic snapshot.\n\n" +
      "**GPA:** 3.42\n**Attendance:** 92%\n**Holds:** None\n\n" +
      "**How to access:**\n- Open [Blackboard](https://bb.uaeu.ac.ae)\n- Select the course";
    const spoken = forSpeakingHighlights(answer, "en");
    expect(spoken).toContain("GPA is 3.42");
    expect(spoken).toContain("Attendance is 92%");
    expect(spoken).not.toContain("Open Blackboard");
    expect(spoken.toLowerCase()).toContain("on the screen");
  });

  it("does not repeat the introduction after the first greeting", () => {
    const plan = planVoiceReply(classifyVoiceTurn("Hello again"), { ...mira, introduced: true });
    expect(plan.speech).not.toContain("I'm Mira");
  });

  it("answers thanks without another introduction", () => {
    const plan = planVoiceReply(classifyVoiceTurn("Thanks, Mira."), { ...mira, introduced: true });
    expect(plan.callBusiness).toBe(false);
    expect(plan.speech.toLowerCase()).toContain("welcome");
  });
});
