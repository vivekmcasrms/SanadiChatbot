/**
 * "book" is ambiguous in student language:
 *   - a noun/resource  -> the Library agent ("find me a book on deep learning")
 *   - a scheduling verb -> the Appointment agent ("book me a counsellor")
 *
 * Routing must not key off the isolated word. This module reads the sentence
 * around it and returns one of three deterministic verdicts, so both the
 * appointment intent detector and the domain router agree.
 */

export type BookSense = "library" | "appointment" | "ambiguous" | "none";

/** Vocabulary that only exists in a library context. */
const LIBRARY_STRONG_RE =
  /(librar|e-?books?|ebooks?|textbooks?|journals?|articles?|catalogue|catalog|isbn|call number|shelf|borrow|loan|renew|due date|interlibrary|database|e-?resource|reading list|مكتبة|المكتبة|كتاب|كتب|دورية|مقال|مقالات|إعارة|استعارة|رقم التصنيف|فهرس)/i;

/** Vocabulary that only exists when arranging a meeting. */
const APPOINTMENT_STRONG_RE =
  /(appointment|slot|meeting|consultation|session with|advisor|adviser|counsell?or|موعد|مواعيد|حجز موعد|مقابلة|استشارة|مرشد)/i;

/** "book" used as a thing: a book on X, a book by Y, this book, that book. */
const BOOK_AS_NOUN_RE =
  /\bbooks?\b\s*(on|about|by|titled|called|regarding|for)\b|\b(a|an|the|this|that|any|some|good|new|another|first|second)\s+(good\s+|great\s+|recent\s+)?books?\b|\bbooks?\s*(\?|$)/i;

/** "book" used as an action: book me / book an appointment / book at 3 pm. */
const BOOK_AS_VERB_RE =
  /\bbook(ing)?\b\s+(me|us|my|an?|the)?\s*(appointment|slot|meeting|session|consultation|time|advisor|adviser|counsell?or|visit)?\s*(for|at|on|with|tomorrow|today|next)?\b\s*(\d{1,2}\s*(:\d{2})?\s*(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?/i;

const BOOK_WORD_RE = /\bbook(s|ing)?\b|حجز|احجز|أحجز/i;

/**
 * Decides which agent a message belongs to when "book" (or its Arabic
 * equivalents) appears. Returns "none" when the word is absent.
 */
export function classifyBookSense(text: string): BookSense {
  const t = text.trim();
  if (!t) return "none";

  const library = LIBRARY_STRONG_RE.test(t);
  const appointment = APPOINTMENT_STRONG_RE.test(t);

  // Unambiguous on their own vocabulary alone.
  if (library && !appointment) return "library";
  if (appointment && !library) return "appointment";

  if (!BOOK_WORD_RE.test(t)) return library || appointment ? (library ? "library" : "appointment") : "none";

  const asNoun = BOOK_AS_NOUN_RE.test(t);
  const asVerb = /\bbook(ing)?\s+(me|us)\b/i.test(t) || (BOOK_AS_VERB_RE.test(t) && !asNoun);

  if (asNoun && !asVerb) return "library";
  if (asVerb && !asNoun) return "appointment";
  // Both vocabularies present ("book an appointment at the library"): the
  // grammatical role of "book" decides.
  if (library && appointment) return asVerb ? "appointment" : asNoun ? "library" : "ambiguous";
  return asNoun ? "library" : "ambiguous";
}

/** True when the message clearly asks for a library resource or service. */
export function isLibraryIntent(text: string): boolean {
  return classifyBookSense(text) === "library";
}

/** The one short question to ask when the sense genuinely cannot be decided. */
export function bookClarification(lang: "en" | "ar"): string {
  return lang === "ar"
    ? "هل تريد أن أبحث لك عن كتاب في المكتبة، أم أحجز لك موعداً؟"
    : "Would you like me to find a library book, or book an appointment?";
}
