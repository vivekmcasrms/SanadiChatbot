/**
 * Suggestion intent: a student proposing an improvement to a service
 * ("it would be helpful if career counselling stayed open later") must be
 * recognised as feedback to record, not as a question about that service.
 *
 * Domain words inside a suggestion (career, library, advising...) are the
 * *subject* of the feedback, so this detector runs before every domain fast
 * path. Detection is fully deterministic — the model only phrases the reply.
 */

export type SuggestionSense = "suggestion" | "none";

/** Institutional subjects an improvement suggestion is addressed to. */
const INSTITUTION =
  "(the )?(university|uaeu|college|faculty|campus|library|centre|center|service|department|administration)";

/** Explicit suggestion framing in English and Arabic. */
const SUGGESTION_RE = new RegExp(
  [
    "it (would|could|'d) be (helpful|nice|great|better|useful|good) if",
    "it'?d be (helpful|nice|great|better|useful) if",
    "would(n'?t)? it be (nice|good|better|great|helpful) if",
    "i (would like to )?(suggest|propose|recommend)",
    "my suggestion",
    "i have (a|an) (suggestion|idea)",
    "here is an idea",
    // Institutional improvement framing: "I think the university should…",
    // "the university could offer…", "students would benefit if…".
    `(i (think|believe|feel) )?${INSTITUTION} (should|could|needs to|need to|must|ought to|has to)`,
    "students would benefit",
    "(we|students) (really )?need (more|better|stronger|additional)",
    "there should be (more|better|stronger|additional)",
    "you (should|could) (offer|provide|add|extend|stay|open|run|make|have|start|allow|build|create|partner)",
    `why (don'?t|doesn'?t) (you|${INSTITUTION})`,
    "please (consider|extend|add|offer|provide|open|stay open)",
    `can (you|${INSTITUTION}) (please )?(consider|extend|add|offer|provide|stay open|open (earlier|later))`,
    "i wish (you|the|there)",
    "i'?d love (if|to see)",
    "would love (if|to see)",
    "hope you (can|will|could)",
    "أقترح",
    "اقتراح",
    "لدي اقتراح",
    "عندي اقتراح",
    "يا ليت",
    "لماذا لا",
    "لمَ لا",
    "أتمنى (أن|لو)",
    "أود أن أقترح",
    "أرجو (توفير|إضافة|تمديد|النظر)",
    "لو (يتم|كان هناك|تقومون|تقوم)",
    "أعتقد أن (الجامعة|الكلية|الإدارة|الجهة)",
    "من الأفضل أن",
    "سيكون من (المفيد|الأفضل|الجيد)",
    "(الجامعة|الكلية|الإدارة) (يجب|ينبغي|بإمكانها|يمكنها) أن",
    "نحتاج (إلى )?(المزيد|شراكات|فرص)",
  ].join("|"),
  "i",
);

/**
 * Guard rails: phrasing that contains a suggestion-adjacent word but is
 * actually a personal request or a question about the service.
 * "Can you help me..." is a request, not service feedback — but "can you add
 * weekend hours" IS feedback, so the guard only covers personal pronouns.
 */
const PERSONAL_REQUEST_RE =
  /\b(help me|for me|my (case|request|application|registration|hold|account|record|cv|resume|appointment)|i (need|want|can'?t|cannot|have|am))\b/i;

/** True when the message is feedback/suggestion about how a service runs. */
export function isSuggestionIntent(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (!SUGGESTION_RE.test(t)) return false;
  // "I suggest you help me with my hold" is a request, not feedback.
  if (PERSONAL_REQUEST_RE.test(t) && !/(suggest|اقتراح|أقترح)/i.test(t)) return false;
  return true;
}
