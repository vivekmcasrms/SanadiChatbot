/**
 * Emirati Arabic language layer (pure, browser-safe).
 *
 * - Understanding: maps common Emirati / Gulf spellings and code-switched
 *   phrases to a standard gloss so intent matchers do not require formal Arabic.
 * - Style: one place that defines how Sanadi writes and speaks Arabic, chosen
 *   by an admin setting instead of prompts scattered through the app.
 */

export const ARABIC_STYLES = ["msa", "uae_professional", "uae_conversational"] as const;
export type ArabicStyle = (typeof ARABIC_STYLES)[number];
export const DEFAULT_TEXT_STYLE: ArabicStyle = "uae_professional";
export const DEFAULT_VOICE_STYLE: ArabicStyle = "uae_conversational";

export const ARABIC_STYLE_LABELS: Record<ArabicStyle, { en: string; ar: string }> = {
  msa: { en: "Modern Standard Arabic", ar: "العربية الفصحى" },
  uae_professional: { en: "UAE Professional Arabic", ar: "عربية إماراتية مهنية" },
  uae_conversational: { en: "UAE Conversational Arabic", ar: "عربية إماراتية محكية" },
};

export function asArabicStyle(value: unknown, fallback: ArabicStyle): ArabicStyle {
  return (ARABIC_STYLES as readonly string[]).includes(String(value)) ? (value as ArabicStyle) : fallback;
}

/** Context decides how much dialect is allowed, whatever the configured style. */
export type ArabicContext = "casual" | "academic" | "official";

const AVOID =
  "Avoid Egyptian (عايز، دلوقتي، كده، إزيك، بتاع)، Levantine (هلأ، شو بدك، كتير، منيح) and Saudi-only expressions (وش، مره بمعنى جداً، يب)، exaggerated or stereotypical Gulf slang (مرحبا الساع، لا تشيل هم، يا الغالي)، and anything that could sound disrespectful in a university.";

/** Arabic writing rules for on-screen replies. */
export function arabicStyleBlock(style: ArabicStyle): string {
  if (style === "msa") {
    return `\nARABIC STYLE\nWrite Arabic replies in clear, simple Modern Standard Arabic. ${AVOID}\n`;
  }
  const base =
    style === "uae_conversational"
      ? "Write Arabic replies in light, natural Emirati conversational Arabic as a helpful UAEU assistant would speak to a student."
      : "Write Arabic replies in clear professional Arabic with a light, natural Emirati touch — the way a respected UAEU staff member writes to a student.";
  return `\nARABIC STYLE\n${base}
- Casual or greeting turns: natural Emirati wording is welcome (شو، الحين، زين، أقدر، وين، ليش، إن شاء الله), used sparingly — never in every sentence.
- Academic information: mostly clear Arabic with at most a light conversational touch.
- Official actions (complaints, programme transfer, hostel booking, documents, approvals, academic decisions, confirmations, reference numbers): clear professional Arabic, no slang.
- Never rewrite every sentence into dialect. Local enough to feel familiar, professional enough for UAEU.
- Keep course codes, GPA, request numbers and English programme names exactly as they are.
${AVOID}\n`;
}

/** Spoken Arabic rules (Talk to Sanadi and read-aloud). */
export function voiceStyleBlock(style: ArabicStyle): string {
  if (style === "msa") {
    return `Arabic voice style: clear, friendly Modern Standard Arabic in one to three short sentences. ${AVOID}`;
  }
  const tone =
    style === "uae_conversational"
      ? "natural Emirati conversational Arabic with a UAE (Abu Dhabi / Al Ain) accent"
      : "clear Arabic with a light Emirati accent and wording";
  return `Arabic voice style: speak ${tone}, in one to three short sentences, like a helpful UAEU staff member. Use local words naturally and sparingly (شو، الحين، زين، أقدر، اللي، وين، إن شاء الله). For confirmations of official actions, reference numbers and decisions, speak clearly and professionally without slang. Say the full details are shown below the reply; never say "check the screen". ${AVOID}`;
}

/** Short steer for the read-aloud engine. */
export function ttsArabicSteer(style: ArabicStyle): string {
  return style === "msa"
    ? "اقرأ النص التالي بالعربية الفصحى بنبرة ودودة وواضحة:"
    : "اقرأ النص التالي بلهجة إماراتية طبيعية ومحترمة، بنبرة ودودة وواضحة، كموظف في جامعة الإمارات:";
}

/* ------------------------------------------------------------------ */
/* Understanding                                                       */
/* ------------------------------------------------------------------ */

/** Emirati / Gulf markers → standard gloss used for intent matching. */
const GLOSS: [RegExp, string][] = [
  [/(^|\s)(شو|شنو)(?=\s|$|[؟?])/g, "$1ما"],
  [/(^|\s)(أبغي|ابغي|أبغى|ابغى|أبي|ابي|ودي|أبا|ابا)(?=\s|$)/g, "$1أريد"],
  [/(^|\s)(مب|مو)(?=\s|$)/g, "$1ليس"],
  [/(^|\s)وين(?=\s|$)/g, "$1أين"],
  [/(^|\s)(ألقى|القى|ألاقي|الاقي)(?=\s|$)/g, "$1أجد"],
  [/(^|\s)سو لي(?=\s|$)/g, "$1اعمل لي"],
  [/(^|\s)خلصه لي(?=\s|$)/g, "$1أنجزه لي"],
  [/(^|\s)شوف لي(?=\s|$)/g, "$1تحقق لي"],
  [/(^|\s)خبرني(?=\s|$)/g, "$1أخبرني"],
  [/(^|\s)(اللي)(?=\s|$)/g, "$1الذي"],
  [/(^|\s)(الحين)(?=\s|$)/g, "$1الآن"],
  [/(^|\s)ما يفتح(?=\s|$)/g, "$1لا يفتح"],
  [/(^|\s)ما يشتغل(?=\s|$)/g, "$1لا يعمل"],
  [/(^|\s)ما أقدر(?=\s|$)/g, "$1لا أستطيع"],
  [/(^|\s)أقدر(?=\s|$)/g, "$1هل أستطيع"],
  [/(^|\s)مال(?=\s|$)/g, "$1الخاص ب"],
  [/الوظايف/g, "الوظائف"],
  [/وظايف/g, "وظائف"],
  [/(^|\s)(الباص|باص)(?=\s|$)/g, "$1الحافلة"],
];

const EMIRATI_MARKERS =
  /(^|\s)(شو|شنو|أبغي|ابغي|أبغى|أبي|ودي|مب|وين|الحين|زين|هيه|اللي|سو لي|شوف لي|خبرني|خلصه لي|ألقى|القى|مال|وايد|أقدر|ما أقدر|عادي|خلاص|تمام)(?=\s|$|[؟?.!،])/;
const OTHER_DIALECT = /(عايز|عاوز|دلوقتي|كده|إزيك|ازيك|بتاع|ازاي|هلأ|شو بدك|كتير|منيح|وش\s)/;
const ARABIC = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]{2,}/;

export type DialectReading = {
  language: "ar" | "en" | "mixed";
  dialect: "emirati" | "msa" | "other_dialect" | "none";
  markers: string[];
  codeSwitched: boolean;
};

export function readDialect(text: string): DialectReading {
  const t = text ?? "";
  const hasAr = ARABIC.test(t);
  const hasEn = LATIN.test(t.replace(/UAEU-\d{4}-\d+|[A-Z]{2,5}\d{3}/g, ""));
  const language = hasAr && hasEn ? "mixed" : hasAr ? "ar" : "en";
  const markers = [...t.matchAll(new RegExp(EMIRATI_MARKERS.source, "g"))].map((m) => m[2]!).filter(Boolean);
  const dialect = !hasAr ? "none" : OTHER_DIALECT.test(t) ? "other_dialect" : markers.length ? "emirati" : "msa";
  return { language, dialect, markers: [...new Set(markers)], codeSwitched: hasAr && hasEn };
}

/** Standard gloss of an Emirati sentence, for matching only — never shown as a reply. */
export function emiratiGloss(text: string): string {
  let out = ` ${text ?? ""} `;
  for (const [re, rep] of GLOSS) out = out.replace(re, rep);
  return out.trim();
}

/** Matches either the original sentence or its standard gloss. */
export function matchesEmirati(re: RegExp, text: string): boolean {
  return re.test(text) || re.test(emiratiGloss(text));
}
