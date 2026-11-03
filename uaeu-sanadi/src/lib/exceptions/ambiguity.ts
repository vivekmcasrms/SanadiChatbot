/**
 * Ambiguous-request detection.
 *
 * "I have a problem with my record" names no service, no record field and no
 * action. Guessing is the wrong recovery: Sanadi asks exactly one focused
 * clarification question instead. Deterministic and shared by the live
 * assistant and the controlled exception test, so both exercise one rule.
 */

export type AmbiguityTopic = "record" | "request" | "service" | "problem";

export type AmbiguousRequest = {
  topic: AmbiguityTopic;
  question: { en: string; ar: string };
};

/** Vague problem statements with no actionable subject. */
const VAGUE_RE =
  /^(?:\s*(?:hi|hello)?[,\s]*)?(?:i (?:have|'?ve got|am having|got)\s+(?:a|an|some)?\s*(?:problem|issue|trouble|difficulty)|there(?:'s| is)\s+(?:a|an)\s*(?:problem|issue)|something (?:is )?(?:wrong|not right)|it(?:'s| is) not working|help me(?: please)?$|i need help$|i have a question$|عندي (?:مشكلة|مشكله|استفسار)|لدي مشكلة|في مشكلة|شيء غير صحيح|أحتاج مساعدة$)/i;

/** A subject specific enough to act on — if present the request is not vague. */
const SPECIFIC_RE =
  /\b(gpa|grade|course|register|registration|hold|letter|certificate|transcript|housing|hostel|bus|transport|library|book|appointment|meeting|internship|cv|scholarship|fee|payment|wifi|graduation|attendance|exam|instructor|schedule|uaeu-\d{4}-\d+)\b|(معدل|درجة|مقرر|تسجيل|إيقاف|خطاب|شهادة|سكن|حافلة|مكتبة|كتاب|موعد|تدريب|سيرة|منحة|رسوم|واي ?فاي|تخرج|امتحان|جدول)/i;

const RECORD_RE = /\b(record|file|profile|account|data|information)\b|(سجل|ملفي|بياناتي|حسابي)/i;

const QUESTIONS: Record<AmbiguityTopic, { en: string; ar: string }> = {
  record: {
    en: "I can help with that. Which part of your record is it — your grades and GPA, your registered courses, a hold on your account, or your personal details?",
    ar: "يسعدني مساعدتك. أي جزء من سجلك تحديداً — الدرجات والمعدل، المقررات المسجلة، إيقاف على حسابك، أم بياناتك الشخصية؟",
  },
  request: {
    en: "I can help. Which request do you mean — send me its reference number (for example UAEU-2026-01023), or tell me what it was about.",
    ar: "يمكنني المساعدة. أي طلب تقصد؟ أرسل الرقم المرجعي (مثل UAEU-2026-01023) أو أخبرني بموضوعه.",
  },
  service: {
    en: "I can help. Which service is it about — registration, housing, the library, transport, careers, or something else?",
    ar: "يمكنني المساعدة. أي خدمة تقصد — التسجيل، السكن، المكتبة، النقل، المهن، أم شيء آخر؟",
  },
  problem: {
    en: "I can help with that. In one line, what is the problem about — for example registration, a hold, housing, transport, the library, or a document you need?",
    ar: "يسعدني مساعدتك. بسطر واحد، ما موضوع المشكلة — التسجيل، إيقاف، السكن، النقل، المكتبة، أم مستند تحتاجه؟",
  },
};

/**
 * Returns the single clarification question to ask, or null when the request
 * is specific enough to act on.
 */
export function detectAmbiguousRequest(text: string): AmbiguousRequest | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 160) return null;
  if (!VAGUE_RE.test(t)) return null;
  if (SPECIFIC_RE.test(t)) return null;
  const topic: AmbiguityTopic = RECORD_RE.test(t)
    ? /\b(request|case)\b|(طلب|حالة)/i.test(t)
      ? "request"
      : "record"
    : "problem";
  return { topic, question: QUESTIONS[topic] };
}
