/**
 * Does the retrieved evidence actually cover the question?
 *
 * Similarity scores alone are not proof: a question about a programme the
 * university does not run still pulls back the closest refund policy. The
 * subject words of the question must appear in the retrieved text, otherwise
 * there is no approved source for what was asked — a missing-knowledge
 * exception, not an answer.
 */

const STOPWORDS = new Set([
  "about","after","again","against","allow","allowance","among","another","around","because","before","being",
  "between","could","during","every","first","from","have","having","here","how","into","ится","just","know",
  "later","like","make","many","more","most","much","must","need","only","other","over","policy","please",
  "programme","program","question","really","regarding","related","request","require","required","same","should",
  "since","some","such","take","tell","than","that","their","them","then","there","these","they","thing","this",
  "those","through","time","under","university","uaeu","used","using","very","what","when","where","which","while",
  "will","with","would","your","yours","students","student","course","courses","information","details","currently",
]);

/** Content words distinctive enough that an answer should mention them. */
export function distinctiveTerms(question: string): string[] {
  const words = (question ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const terms = words.filter((w) => {
    if (STOPWORDS.has(w)) return false;
    if (/\d/.test(w) && w.length >= 4) return true; // codes such as ZQXJVK9931, CSBP220
    return w.length >= 6;
  });
  return Array.from(new Set(terms));
}

/**
 * True when the retrieved evidence actually covers the question's subject:
 * every code-like token (a course code, a scheme reference) must appear, and
 * at least half of the remaining subject words. With no distinctive words the
 * question is generic and the normal grounding check applies.
 */
export function evidenceCoversQuestion(evidence: string, question: string): boolean {
  const terms = distinctiveTerms(question);
  if (!terms.length) return true;
  const haystack = (evidence ?? "").toLowerCase();
  if (!haystack.trim()) return false;
  const codes = terms.filter((t) => /\d/.test(t));
  if (codes.some((c) => !haystack.includes(c))) return false;
  const words = terms.filter((t) => !/\d/.test(t));
  if (!words.length) return true;
  // Prefix matching so "withdrawing" is covered by "withdrawal".
  const hits = words.filter((w) => haystack.includes(w.slice(0, 5))).length;
  return hits / words.length >= 0.5;
}
