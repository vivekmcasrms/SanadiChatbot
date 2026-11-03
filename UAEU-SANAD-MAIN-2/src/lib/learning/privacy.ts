/**
 * Privacy for the learning layer: the Learning Center shows patterns, never
 * personal records. Every example stored on a candidate is masked first.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(\+?\d[\d\s-]{7,}\d)/g;
const ID_RE = /\b\d{6,}\b/g;
const REF_RE = /\bUAEU-\d{4}-\d+\b/gi;

/** Replaces identifiers with neutral placeholders. Safe to store and display. */
export function maskExample(text: string | null | undefined, maxLength = 240): string {
  if (!text) return "";
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(REF_RE, "[reference]")
    .replace(PHONE_RE, "[phone]")
    .replace(ID_RE, "[id]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const STOPWORDS = new Set([
  "the","a","an","i","me","my","to","for","of","in","on","is","are","can","do","does","how","what","when","where",
  "please","need","want","would","like","with","and","or","this","that","it","you","your","have","has","get","about",
  "من","في","على","إلى","عن","هل","ما","ماذا","كيف","متى","أين","أريد","أحتاج","لي","هذا","هذه","مع","أو","و",
]);

/** Content words shared by several examples — the basis of a trigger phrase. */
export function sharedKeywords(examples: string[], minOccurrences = 2, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const example of examples) {
    const seen = new Set(
      maskExample(example, 400)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !w.startsWith("[")),
    );
    for (const word of seen) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minOccurrences)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}
