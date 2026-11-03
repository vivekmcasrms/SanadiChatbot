import type { Classification, Intent, Lang, SisAdapter, Urgency } from "./agent-types";

const AR_RE = /[\u0600-\u06FF]/;

const RULES: {
  intent: Intent;
  category: string;
  unit: string | null;
  words: string[];
}[] = [
  {
    intent: "complaint",
    category: "finance",
    unit: "FEES",
    words: ["fee", "tuition", "payment", "refund", "invoice", "رسوم", "دفع", "استرداد", "فاتورة"],
  },
  {
    // Registration, records and document questions are informational; they are
    // answered from the student's record or handled by the matching service
    // tool (e.g. issue_enrollment_letter) — never filed as complaints.
    intent: "query",
    category: "registration",
    unit: "REG",
    words: ["register", "registration", "course", "grade", "transcript", "enrol", "letter", "تسجيل", "مقرر", "درجة", "كشف", "إثبات قيد", "شهادة"],
  },
  {
    intent: "suggestion",
    category: "service_improvement",
    unit: null,
    words: ["suggest", "idea", "improve", "propose", "اقتراح", "فكرة", "تحسين"],
  },
  {
    intent: "alert",
    category: "alerts",
    unit: null,
    words: ["alert", "deadline", "reminder", "تنبيه", "موعد", "تذكير"],
  },
];

const SENSITIVE = [
  "harass",
  "discriminat",
  "unsafe",
  "safety",
  "assault",
  "threat",
  "تحرش",
  "تمييز",
  "سلامة",
  "تهديد",
];

const NEGATIVE = ["angry", "unfair", "terrible", "worst", "ignored", "غاضب", "ظلم", "سيء", "تجاهل"];
const URGENT = ["urgent", "immediately", "today", "asap", "عاجل", "فوراً", "اليوم"];

export function detectLanguage(text: string): Lang {
  return AR_RE.test(text) ? "ar" : "en";
}

/**
 * Orchestrator Agent (mocked classifier).
 * Deterministic, rule-based routing until the model-backed classifier is enabled.
 */
export function classify(text: string): Classification {
  const lower = text.toLowerCase();
  const language = detectLanguage(text);
  const match = RULES.find((rule) => rule.words.some((w) => lower.includes(w)));
  const isQuestion = /\?|^(how|what|when|where|can|do|is)\b|كيف|ما هي|متى|أين|هل/.test(lower);

  let intent: Intent = match?.intent ?? (isQuestion ? "query" : "unknown");
  if (match?.intent === "complaint" && isQuestion) intent = "query";

  const sensitive = SENSITIVE.some((w) => lower.includes(w));
  const urgency: Urgency = sensitive
    ? "critical"
    : URGENT.some((w) => lower.includes(w))
      ? "high"
      : intent === "complaint"
        ? "medium"
        : "low";

  return {
    intent,
    category: sensitive ? "sensitive" : (match?.category ?? "general"),
    language,
    urgency,
    sentiment: NEGATIVE.some((w) => lower.includes(w)) || intent === "complaint" ? "negative" : "neutral",
    requiredUnitCode: match?.unit ?? null,
    requiredUnitName: null,
    requiresAuth: true,
    requiresStudentData: /my |mine|حسابي|رصيدي|درجاتي/.test(lower),
    actionRequested: intent === "complaint" || intent === "suggestion",
    requiresHumanEscalation: sensitive,
    // A recognised personal-record question is deterministic evidence, not a
    // guess: it is answered from the student's own records, so it must not
    // carry the generic 0.6 prior that buys an extra supervisor round-trip.
    confidence: match ? 0.82 : detectStudentDataIntent(text) && isQuestion ? 0.85 : isQuestion ? 0.6 : 0.4,
  };
}

/** Placeholder SIS adapter: typed surface only, no live integration yet. */
export const sisAdapter: SisAdapter = {
  async getEnrollment() {
    return { available: false, reason: "SIS integration not connected" };
  },
  async getFinancialBalance() {
    return { available: false, reason: "SIS integration not connected" };
  },
};

/** Prompt-injection / moderation placeholders — kept server-side on purpose. */
export function sanitizeUserInput(text: string): string {
  return text.replace(/\u0000/g, "").slice(0, 4000).trim();
}

/* ------------------------------------------------------------------ */
/* Per-user rate limiting (sliding window)                             */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 15;
const BURST_MS = 10_000;
const MAX_PER_BURST = 5;

const hits = new Map<string, number[]>();

/**
 * Protects the assistant from accidental overload and abuse while staying
 * invisible to normal student usage (a student rarely exceeds 15 turns/min).
 */
export function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  const burst = recent.filter((t) => now - t < BURST_MS);
  if (recent.length >= MAX_PER_MINUTE || burst.length >= MAX_PER_BURST) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  // Opportunistic cleanup keeps the map bounded under high concurrency.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}
/** Detects personal, record-backed intents that must be answered from the database. */
export function detectStudentDataIntent(text: string): string | null {
  const l = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => l.includes(x));
  // Identity always comes from the verified student record, never from chat memory.
  if (
    has(
      "who am i",
      "what is my name",
      "what is my email",
      "what's my email",
      "what is my university email",
      "what's my university email",
      "my email address",
      "my username",
      "my major",
      "my programme",
      "my program",
      "my college",
      "my faculty",
      "my current term",
      "who i am",
      "my student id",
      "my student number",
      "my profile",
      "my details",
      "my information",
      "من أنا",
      "منو أنا",
      "ما اسمي",
      "اسمي",
      "رقمي الجامعي",
      "بياناتي",
      "ملفي",
    )
  )
    return "identity";
  const coursey = has("course", "subject", "class", "مادة", "مواد", "مقرر", "مقررات");
  if (coursey) {
    if (has("remain", "left", "still need", "yet to", "haven't taken", "متبق", "باقي", "لم أدرس"))
      return "remaining_courses";
    if (has("complete", "passed", "finished", "taken", "مكتمل", "أكملت", "اجتزت", "درست"))
      return "completed_courses";
    if (has("current", "this semester", "this term", "registered", "enrolled", "now", "الحالي", "هذا الفصل", "مسجل"))
      return "current_courses";
  }
  if (has("alert", "notification", "تنبيه", "تنبيهات", "إشعار")) return "alerts";
  if (has("my case", "my request", "my complaint", "case status", "حالتي", "طلبي", "طلباتي", "شكواي"))
    return "cases";
  if (has("hold", "block", "قيد", "قيود", "محظور", "موقوف")) {
    if (has("register", "registration", "تسجيل")) return "registration_block";
    return "holds";
  }
  if (has("graduat", "تخرج", "التخرج", "remaining credit", "ساعات متبقية")) return "graduation";
  if (has("gpa", "standing", "معدل", "المعدل", "وضعي الأكاديمي", "credits", "ساعات")) return "academic_status";
  return null;
}
