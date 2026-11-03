/**
 * Governed intent routing — the single contract every turn is routed by.
 *
 *   The classifier decides what the student means.
 *   Service rules decide what the student is eligible for.
 *   Tools execute the action.
 *
 * This module is pure (no I/O). Regex is used here ONLY for high-precision,
 * deterministic signals: case references, unmistakable emergencies and
 * explicit identifiers. Meaning comes from the semantic classifier
 * (classifier.server.ts); `heuristicClassify` is its offline fallback when the
 * model is unavailable or too slow, and is never allowed to route on a single
 * topic word ("job", "hostel", "transfer", "library", "registration").
 */
import { emiratiGloss } from "@/lib/arabic/emirati";

export const INTENTS = [
  "general_query",
  "university_fact_query",
  "academic_query",
  "career_counselling",
  "library_query",
  "complaint",
  "suggestion",
  "alert",
  "service_request",
  "existing_case_followup",
  "objection_correction",
  "human_assistance",
  "hostel_booking",
  "program_transfer",
  "appointment",
] as const;
export type Intent = (typeof INTENTS)[number];

export type RoutingDomain =
  | "general"
  | "academic"
  | "career"
  | "library"
  | "cases"
  | "alerts"
  | "housing"
  | "transfer"
  | "appointments"
  | "document"
  | "feedback";

export type RoutingEntities = {
  courseCodes?: string[] | undefined;
  roomCode?: string | null;
  year?: number | null;
  futureTense?: boolean;
  emergency?: boolean;
};

export type RoutingDecision = {
  intent: Intent;
  domain: RoutingDomain;
  confidence: number;
  entities: RoutingEntities;
  case_reference: string | null;
  topic_changed: boolean;
  /** Where the decision came from — for internal logs only. */
  source: "deterministic" | "semantic" | "heuristic" | "sticky";
  /** Present only when confidence is too low to act: ONE short question. */
  clarification?: { en: string; ar: string } | null;
};

export const INTENT_DOMAIN: Record<Intent, RoutingDomain> = {
  general_query: "general",
  university_fact_query: "general",
  academic_query: "academic",
  career_counselling: "career",
  library_query: "library",
  complaint: "feedback",
  suggestion: "feedback",
  alert: "alerts",
  service_request: "document",
  existing_case_followup: "cases",
  objection_correction: "cases",
  human_assistance: "cases",
  hostel_booking: "housing",
  program_transfer: "transfer",
  appointment: "appointments",
};

/** Below this the turn is not acted on; one short clarification is asked. */
export const CLARIFY_BELOW = 0.5;

// ---------------------------------------------------------------- deterministic

export const CASE_REFERENCE_RE = /\b(UAEU-\d{4}-\d{3,8})\b/i;
/** Unmistakable, high-precision emergency wording only (not "urgent"). */
export const EMERGENCY_RE =
  /\b(fire|smoke|explosion|ambulance|bleeding|unconscious|choking|gas leak|heart attack|can'?t breathe|someone (is )?(hurt|injured|collapsed))\b|حريق|دخان|انفجار|إسعاف|اسعاف|نزيف|إغماء|اغماء|تسرب غاز|ما يتنفس|لا يتنفس/i;
const COURSE_CODE_RE = /\b([A-Z]{2,4})\s?-?(\d{3,4})\b/g;
const ROOM_RE = /\b([ABC])-?(\d{3})\b/i;
const YEAR_RE = /\b(20[2-9]\d)\b/;
const FUTURE_RE = /\b(will|going to|next (year|semester|term)|in 20[3-9]\d)\b|سوف|سيدرس|راح|بيدرس|العام القادم|السنة الياية|السنة الجاية/i;

export function extractEntities(text: string, now = new Date()): RoutingEntities {
  const courseCodes = [...text.matchAll(COURSE_CODE_RE)]
    .map((m) => `${m[1]}${m[2]}`)
    .filter((c) => !/^UAEU/.test(c));
  const room = ROOM_RE.exec(text);
  const yearMatch = YEAR_RE.exec(text);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  return {
    courseCodes: courseCodes.length ? [...new Set(courseCodes)] : undefined,
    roomCode: room ? `${room[1]!.toUpperCase()}-${room[2]}` : null,
    year,
    futureTense: FUTURE_RE.test(text) || (year !== null && year > now.getFullYear()),
    emergency: EMERGENCY_RE.test(text),
  };
}

export function detectCaseRef(text: string): string | null {
  const m = CASE_REFERENCE_RE.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

// ---------------------------------------------------------------- sticky context

/** How long each kind of saved context may steer later turns. */
export const STICKY_TTL_MS = {
  transferTarget: 30 * 60 * 1000,
  careerDomain: 20 * 60 * 1000,
  pendingAppointment: 30 * 60 * 1000,
  hostelFlow: 20 * 60 * 1000,
  activeCase: 60 * 60 * 1000,
} as const;
export type StickyKind = keyof typeof STICKY_TTL_MS;

export type StickyContext = Partial<Record<StickyKind, { value: string; at: string }>>;

/** Drops every sticky entry older than its TTL. */
export function liveSticky(ctx: StickyContext | null | undefined, now = Date.now()): StickyContext {
  const out: StickyContext = {};
  for (const [k, v] of Object.entries(ctx ?? {}) as [StickyKind, { value: string; at: string }][]) {
    if (!v?.value || !v.at) continue;
    const at = Date.parse(v.at);
    if (Number.isFinite(at) && now - at < STICKY_TTL_MS[k]) out[k] = v;
  }
  return out;
}

const STICKY_INTENT: Record<StickyKind, Intent> = {
  transferTarget: "program_transfer",
  careerDomain: "career_counselling",
  pendingAppointment: "appointment",
  hostelFlow: "hostel_booking",
  activeCase: "existing_case_followup",
};

/** Short, content-free follow-ups ("and the credits?", "زين", "what about it?"). */
const FOLLOW_UP_RE =
  /^(and|also|what about|how about|ok(ay)?|yes|no|sure|so|then|which|the first|that one|it|this)\b|^(و|طيب|زين|تمام|هيه|لا|اوكي|وبعدين|شو عن|ماذا عن)/i;
export function isShortFollowUp(text: string): boolean {
  const t = text.trim();
  return t.length <= 60 && (FOLLOW_UP_RE.test(t) || t.split(/\s+/).length <= 4);
}

// ---------------------------------------------------------------- heuristic fallback

type Scored = { intent: Intent; confidence: number };

const T = {
  // complaints: a problem the student is experiencing
  complaint:
    /\b(problem|issue|complain\w*|not working|broken|late again|always late|rude|unfair|terrible|disappointed|frustrat\w*|unacceptable|keeps? (failing|crashing)|never (arrives|answers))\b|شكوى|مشكلة|مشكله|ما يشتغل|خربان|متأخر|سيء|سيئ|ظلم|زعلان|متضايق/i,
  // suggestions: how the university SHOULD change (institutional improvement)
  suggestion:
    /\b(should (partner|add|offer|provide|open|extend|have|introduce|consider|improve|create)|would be (great|helpful|nice|better) if|i suggest|my suggestion|it would help if|please (consider|add)|recommend that the university|why not (add|have|open))\b|أقترح|اقترح|اقتراح|ياليت|يا ليت|ليت الجامعة|المفروض الجامعة|لازم الجامعة|ودي لو|يكون أحسن لو/i,
  career:
    /\b(jobs? (suit|for|fit)|career (path|advice|options?|counsel\w*)|what (jobs?|careers?|roles?) (suit|fit|match)|(suit|fit|match)s? me|cv|resume|interview prep\w*|skills? (gap|i need|missing)|after (i )?graduat\w*.{0,20}(work|job|do))\b|وظيفة تناسبني|وظايف تناسبني|شو الوظايف|المسار المهني|سيرتي الذاتية|السيرة الذاتية|مقابلة عمل|شو أشتغل/i,
  library:
    /\b(books? (about|on)|borrow|renew (my )?(book|loan)|library (hours|opening|open)|find (a |me )?(book|article|journal|thesis)|e-?books?|textbook|study room|database access)\b|كتاب عن|كتب عن|استعارة|المكتبة|كتاب مقرر|قاعدة بيانات/i,
  hostel:
    /\b(book|reserve|get|need|want|apply for)\b[^.?!]{0,24}\b(a |the |my )?(room|hostel|dorm\w*|accommodation)\b|\b(hostel|dorm(itory)?|student housing) (room|booking|application)\b|\b(move|upgrade) to (a )?(single room|hostel a)\b|(أحجز|احجز|حجز|أبغي|ابغي|أبي|ابي|ودي|أريد)[^\n.؟!]{0,12}(غرفة|غرفه|سكن|السكن)/i,
  transfer:
    /\b(transfer|switch|move|change)\b.{0,40}\b(program(me)?|college|major|specialization|to (computer science|biology|data science))\b|\b(program(me)?|college|major) transfer\b|(أحول|احول|أحوّل|تحويل|أنتقل|انتقل|أغير|اغير|غير)[^\n.؟!]{0,20}(تخصص|تخصصي|كلية|الكلية|برنامج|البرنامج)/i,
  appointment:
    /\b(appointment|meet(ing)? with|book (a )?(meeting|session|slot)|schedule (a )?(meeting|call)|see (an |my )?(advisor|counsell?or))\b|موعد|مقابلة مع|أقابل|اقابل|اجتماع مع/i,
  academic:
    /\b(gpa|credits?|credit hours|graduat\w*|transcript|prerequisite|courses? (left|remaining)|study plan|register (for)?|registration|drop|withdraw|add a course|hold on my|my grades?)\b|معدلي|ساعاتي|تخرجي|كشف الدرجات|المتطلب|خطتي الدراسية|التسجيل|أسجل|اسجل|سحب مقرر/i,
  service:
    /\b(letter|certificate|to whom it may concern|enrol(l)?ment (letter|proof)|proof of study|id card replacement|official document)\b|شهادة|إفادة|خطاب|إلى من يهمه الأمر|رسالة رسمية/i,
  caseFollow:
    /\b(status of my|my (request|case|complaint|application)|any update|what happened (to|with) my|is my (request|case|booking)|has my (request|case))\b|طلبي|حالة طلبي|status مال|شكواي|وين وصل|متى يخلص/i,
  correction:
    /\b(that'?s (wrong|not (right|correct|what i))|no,? i meant|not what i (asked|meant)|you misunderstood|incorrect|my record is wrong)\b|غلط|مو صحيح|مب صحيح|مش صحيح|ما قصدت|قصدي|فهمتني غلط|سجلي غلط/i,
  human:
    /\b(talk|speak) (to|with) (a |an )?(human|person|staff|someone|agent|officer)|real person|human agent\b|أبغي أكلم موظف|ابغي اكلم موظف|أكلم شخص|موظف حقيقي|كلمني موظف/i,
  fact:
    /\b(who (is|will|teaches|taught)|when (is|does|will)|where is|how many|what (time|year) (is|does|will)|does uaeu|is there a)\b|منو|من يدرس|متى|وين|كم عدد|هل يوجد|هل في/i,
  alert:
    /\b(report (a|an)? ?(incident|hazard|safety)|lost (my )?(wallet|phone|id|card|laptop|bag|keys)|stolen|someone (is )?following|harass\w*)\b|ضاع|ضاعت|سرق|فقدت|بلاغ|تحرش/i,
};

/**
 * Offline fallback. Each intent needs a phrase that carries the student's
 * MEANING (a request, a problem, an improvement) — never a bare topic word.
 * Meaning-bearing intents (suggestion, complaint, correction, human) are
 * scored ahead of the domain they mention.
 */
export function heuristicClassify(text: string, now = new Date()): Scored {
  const s = `${text}\n${emiratiGloss(text)}`;
  const e = extractEntities(text, now);
  if (T.human.test(s)) return { intent: "human_assistance", confidence: 0.85 };
  if (T.correction.test(s)) return { intent: "objection_correction", confidence: 0.75 };
  if (T.suggestion.test(s)) return { intent: "suggestion", confidence: 0.85 };
  if (T.alert.test(s)) return { intent: "alert", confidence: 0.75 };
  if (T.complaint.test(s) && !/\?\s*$/.test(text.trim()) ) return { intent: "complaint", confidence: 0.8 };
  if (T.complaint.test(s)) return { intent: "complaint", confidence: 0.65 };
  if (T.caseFollow.test(s)) return { intent: "existing_case_followup", confidence: 0.75 };
  if (T.transfer.test(s)) return { intent: "program_transfer", confidence: 0.85 };
  if (T.hostel.test(s)) return { intent: "hostel_booking", confidence: 0.85 };
  if (T.career.test(s)) return { intent: "career_counselling", confidence: 0.8 };
  if (T.appointment.test(s)) return { intent: "appointment", confidence: 0.8 };
  if (T.library.test(s)) return { intent: "library_query", confidence: 0.8 };
  if (T.service.test(s)) return { intent: "service_request", confidence: 0.75 };
  if (e.futureTense && T.fact.test(s)) return { intent: "university_fact_query", confidence: 0.75 };
  if (T.academic.test(s)) {
    // Personal phrasing makes it the student's own academic question; a bare
    // topic word ("registration") is not enough to route confidently.
    const personal = /\b(my|i|am i|do i|can i|me)\b|\?|؟|كم|متى|هل|ـي\b|ي\s|ي$/i.test(text) && text.trim().split(/\s+/).length > 1;
    return { intent: "academic_query", confidence: personal ? 0.7 : 0.55 };
  }
  if (T.fact.test(s)) return { intent: "university_fact_query", confidence: 0.6 };
  if (/\?|؟/.test(text)) return { intent: "general_query", confidence: 0.55 };
  return { intent: "general_query", confidence: 0.35 };
}

// ---------------------------------------------------------------- resolution

const CLARIFY = {
  en: "Could you tell me a little more — is this a question, a problem you want to report, or something you want to request?",
  ar: "ممكن توضح لي أكثر — هل هذا سؤال، أو مشكلة تبغي تبلغ عنها، أو طلب تبغي تقدمه؟",
};

export type RouteInput = {
  text: string;
  sticky?: StickyContext | null;
  /** Result of the semantic classifier; null when it failed or timed out. */
  semantic?: Scored | null;
  explicitTopicChange?: boolean;
  now?: Date;
};

/**
 * Combines deterministic signals, the semantic result, and sticky context.
 * Priority: case reference > emergency > explicit meaning > sticky follow-up.
 * Saved context never overrides an obvious topic change.
 */
export function resolveRoute(input: RouteInput): RoutingDecision {
  const now = input.now ?? new Date();
  const text = input.text ?? "";
  const entities = extractEntities(text, now);
  const sticky = liveSticky(input.sticky, now.getTime());
  const caseRef = detectCaseRef(text);
  const mk = (
    intent: Intent,
    confidence: number,
    source: RoutingDecision["source"],
    topic_changed: boolean,
    case_reference: string | null = caseRef,
  ): RoutingDecision => ({
    intent,
    domain: INTENT_DOMAIN[intent],
    confidence,
    entities,
    case_reference,
    topic_changed,
    source,
    clarification: confidence < CLARIFY_BELOW ? CLARIFY : null,
  });

  // 1. A named case reference always wins.
  if (caseRef) return mk("existing_case_followup", 0.99, "deterministic", false);
  // 2. Unmistakable emergency.
  if (entities.emergency) return mk("alert", 0.95, "deterministic", true, null);

  const heuristic = heuristicClassify(text, now);
  let meaning = input.semantic ?? heuristic;
  // A generic semantic label never hides a clear, meaning-bearing service
  // request the high-precision phrases recognise ("أبغي أحول تخصصي").
  const GENERIC: Intent[] = ["general_query", "university_fact_query", "academic_query"];
  if (input.semantic && GENERIC.includes(input.semantic.intent) && !GENERIC.includes(heuristic.intent) && heuristic.confidence >= 0.85) {
    meaning = heuristic;
  }
  const source: RoutingDecision["source"] = input.semantic ? "semantic" : "heuristic";
  const stickyIntents = (Object.keys(sticky) as StickyKind[]).map((k) => STICKY_INTENT[k]);
  // A short follow-up inside a live flow ("and the credits?") stays in that
  // flow when it only carries a generic/academic meaning.
  // Questions that belong inside a live flow ("What GPA do I need?" during a
  // transfer) continue it; anything outside these related meanings is a topic change.
  const RELATED: Partial<Record<Intent, Intent[]>> = {
    program_transfer: ["academic_query", "university_fact_query", "general_query"],
    hostel_booking: ["general_query"],
    career_counselling: ["general_query"],
    appointment: ["general_query"],
  };
  const relatedFlow = stickyIntents.find((si) => RELATED[si]?.includes(meaning.intent));
  const followUpInFlow =
    !input.explicitTopicChange &&
    stickyIntents.length > 0 &&
    ((isShortFollowUp(text) && GENERIC.includes(meaning.intent)) || Boolean(relatedFlow));
  const confident = meaning.confidence >= 0.7 && meaning.intent !== "general_query" && !followUpInFlow;
  const topicChanged =
    Boolean(input.explicitTopicChange) ||
    (confident && stickyIntents.length > 0 && !stickyIntents.includes(meaning.intent));

  // 3. Case follow-up without a reference uses the active case, if still live.
  if (meaning.intent === "existing_case_followup" && sticky.activeCase && !input.explicitTopicChange) {
    return mk("existing_case_followup", Math.max(meaning.confidence, 0.8), source, false, sticky.activeCase.value);
  }
  // 4. Clear meaning in this message.
  if (relatedFlow && followUpInFlow) return mk(relatedFlow, 0.75, "sticky", false);
  if (confident || input.explicitTopicChange) return mk(meaning.intent, meaning.confidence, source, topicChanged);
  // 5. Short follow-up inside a live sticky flow continues it.
  if (!topicChanged && isShortFollowUp(text)) {
    const order: StickyKind[] = ["pendingAppointment", "transferTarget", "hostelFlow", "careerDomain", "activeCase"];
    const k = order.find((x) => sticky[x]);
    if (k) return mk(STICKY_INTENT[k], 0.75, "sticky", false, k === "activeCase" ? sticky.activeCase!.value : null);
  }
  return mk(meaning.intent, meaning.confidence, source, topicChanged);
}

/** Never shown to students: compact record for internal routing logs. */
export function routingLogRecord(d: RoutingDecision, handler: string) {
  return {
    intent: d.intent,
    domain: d.domain,
    confidence: Math.round(d.confidence * 100) / 100,
    entities: d.entities,
    case_reference: d.case_reference,
    topic_changed: d.topic_changed,
    source: d.source,
    handler,
  };
}

/** Reads sticky context from saved conversation entities (new + legacy keys). */
export function stickyFromEntities(e: Record<string, unknown>): StickyContext {
  const saved = (e["routingSticky"] ?? {}) as StickyContext;
  const out: StickyContext = { ...saved };
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (!out.transferTarget && str(e["transferActive"])) {
    out.transferTarget = { value: str(e["transferTarget"]) ?? "active", at: str(e["transferActive"])! };
  }
  const appt = (e["appointmentContext"] ?? null) as { awaitingService?: boolean; awaitingSince?: string } | null;
  if (!out.pendingAppointment && appt?.awaitingService && appt.awaitingSince) {
    out.pendingAppointment = { value: "awaiting_service", at: appt.awaitingSince };
  }
  return out;
}

/** Next sticky context after a turn: refresh what this turn used, keep the rest, drop expired. */
export function nextSticky(
  prev: StickyContext,
  touched: Partial<Record<StickyKind, string | null>>,
  now = new Date(),
): StickyContext {
  const out: StickyContext = { ...liveSticky(prev, now.getTime()) };
  for (const [k, v] of Object.entries(touched) as [StickyKind, string | null][]) {
    if (v === null) delete out[k];
    else if (v) out[k] = { value: v, at: now.toISOString() };
  }
  return out;
}
