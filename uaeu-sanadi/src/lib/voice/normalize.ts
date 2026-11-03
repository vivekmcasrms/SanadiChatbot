/**
 * Deterministic clean-up of spoken transcripts so university identifiers
 * survive speech-to-text. Every reshaped case reference or course code is
 * reported so the student can confirm it before Sanadi acts on it.
 */

export type ReshapedItem = { kind: "case_reference" | "course_code"; value: string };
export type NormalizedTranscript = { text: string; reshaped: ReshapedItem[] };

/** Terms sent to the speech service as a vocabulary hint. */
export const VOICE_VOCABULARY = [
  "UAEU",
  "Sanadi",
  "Blackboard",
  "Career Placement",
  "GPA",
  "CSBP220",
  "CSBP320",
  "Machine Learning",
  "To Whom It May Concern",
  "UAEU-2026-01063",
];

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Converts a run of spoken number words ("two twenty", "two two zero") to digits. */
function spokenDigits(words: string[]): string | null {
  let out = "";
  let i = 0;
  while (i < words.length) {
    const w = words[i]!.toLowerCase();
    if (w in UNITS) {
      out += String(UNITS[w]);
      i += 1;
    } else if (w in TEENS) {
      out += String(TEENS[w]);
      i += 1;
    } else if (w in TENS) {
      const next = words[i + 1]?.toLowerCase();
      if (next && next in UNITS && UNITS[next]! > 0) {
        out += String(TENS[w]! + UNITS[next]!);
        i += 2;
      } else {
        out += String(TENS[w]);
        i += 1;
      }
    } else if (/^\d+$/.test(w)) {
      out += w;
      i += 1;
    } else return null;
  }
  return out || null;
}

const NUM_WORD =
  "(?:\\d+|zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";

export function normalizeTranscript(input: string): NormalizedTranscript {
  let text = input.replace(/\s+/g, " ").trim();
  const reshaped: ReshapedItem[] = [];

  // Spelled-out institution name.
  text = text.replace(/\bU\.?\s+A\.?\s+E\.?\s+U\b\.?/gi, "UAEU");

  // Case references: "UAEU 2026 01063", "U A E U-2026-1063".
  text = text.replace(/\bUAEU[\s\-–—.]*(\d{4})[\s\-–—.]*(\d{3,5})\b/gi, (match, y: string, n: string) => {
    const value = `UAEU-${y}-${n.padStart(5, "0")}`;
    if (match !== value) reshaped.push({ kind: "case_reference", value });
    return value;
  });

  // Course codes: 3-4 letters (possibly spelled out) followed by 3 digits,
  // possibly spoken as words. "C S B P two twenty" -> CSBP220.
  const codeRe = new RegExp(
    `\\b((?:[A-Za-z]\\s){2,3}[A-Za-z]|[A-Za-z]{3,4})[\\s\\-]*((?:${NUM_WORD})(?:[\\s\\-]+${NUM_WORD}){0,3})\\b`,
    "gi",
  );
  text = text.replace(codeRe, (match, letters: string, digitsPart: string) => {
    const code = letters.replace(/\s/g, "");
    const spelled = /\s/.test(letters);
    // Only plain 4-letter words are ambiguous ("room 220"); require a known
    // prefix shape: spelled letters, or an all-caps word as written.
    if (!spelled && letters !== letters.toUpperCase()) return match;
    const digits = spokenDigits(digitsPart.split(/[\s-]+/).filter(Boolean));
    if (!digits || digits.length !== 3) return match;
    const value = `${code.toUpperCase()}${digits}`;
    if (match !== value) reshaped.push({ kind: "course_code", value });
    return value;
  });

  // GPA spoken as words: "GPA three point two" -> "GPA 3.2".
  text = text.replace(
    /\bGPA\s+(zero|one|two|three|four|\d)\s+point\s+(zero|one|two|three|four|five|six|seven|eight|nine|\d)(?:\s+(zero|one|two|three|four|five|six|seven|eight|nine|\d))?\b/gi,
    (_m, a: string, b: string, c?: string) => {
      const d = (w: string) => (/^\d$/.test(w) ? w : String(UNITS[w.toLowerCase()]));
      return `GPA ${d(a)}.${d(b)}${c ? d(c) : ""}`;
    },
  );

  // Common terminology.
  text = text
    .replace(/\bblack\s?board\b/gi, "Blackboard")
    .replace(/\bcareer placement\b/gi, "Career Placement")
    .replace(/\bg\.?\s?p\.?\s?a\b\.?/gi, "GPA");

  return { text, reshaped };
}

/** A spoken message needs a quick check when an identifier was reshaped. */
export function needsVoiceConfirmation(reshaped: ReshapedItem[]): boolean {
  return reshaped.length > 0;
}

export function voiceConfirmationPrompt(reshaped: ReshapedItem[], lang: "en" | "ar"): string {
  const item = reshaped[0]!;
  if (lang === "ar") {
    return item.kind === "case_reference"
      ? `سمعت رقم الطلب ${item.value}. هل هذا صحيح؟`
      : `سمعت رمز المقرر ${item.value}. هل هذا صحيح؟`;
  }
  return item.kind === "case_reference"
    ? `I heard the case reference as ${item.value}. Is that correct?`
    : `I heard the course code as ${item.value}. Is that correct?`;
}

/** Arabic vs English by script share, so replies can match the speaker. */
export function detectSpokenLanguage(text: string): "ar" | "en" {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > 0 && arabic >= latin * 0.5 ? "ar" : "en";
}

/** Text safe to read aloud: no markdown, links, references or emoji. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/[*_#>`|~]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}
