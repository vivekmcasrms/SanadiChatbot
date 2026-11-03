/**
 * AI-first assistance before a staff appointment.
 *
 * When a student asks to meet a unit that a Sanadi agent can already help
 * with, Sanadi offers that help ONCE, in the student's language, and never
 * blocks access to a person. Every decision here is deterministic: no model
 * call decides whether the student gets a human.
 */

import type { Lang } from "../agent-types";

export type AssistDomain = "career" | "advising" | "library" | "registration";

export type AppointmentAssistState = {
  unitCode: string | null;
  domain: AssistDomain | null;
  /** Measurement fields — how the appointment request was resolved. */
  appointment_request_origin: "student_request";
  ai_assistance_offered: boolean;
  ai_assistance_accepted: boolean | null;
  ai_resolution_status:
    | "not_offered"
    | "offered"
    | "ai_assisted"
    | "declined"
    | "direct_human";
  human_appointment_requested: boolean;
  human_appointment_booked: boolean;
  /** The last turn offered AI help; this reply answers that offer. */
  awaitingAssistChoice: boolean;
  offeredAt: string | null;
};

/** Units whose routine work a Sanadi agent can already do. */
const UNIT_DOMAIN: Record<string, AssistDomain> = {
  CAREER: "career",
  ADV: "advising",
  ADVISING: "advising",
  LIB: "library",
  REG: "registration",
  ADM: "registration",
  ADMREG: "registration",
};

export function assistDomainForUnit(unitCode: string | null | undefined): AssistDomain | null {
  if (!unitCode) return null;
  return UNIT_DOMAIN[unitCode.toUpperCase()] ?? null;
}

/** Only capabilities that really exist for that unit are ever offered. */
const CAPABILITIES: Record<AssistDomain, { en: string[]; ar: string[] }> = {
  career: {
    en: [
      "review your saved CV",
      "calculate your ATS score",
      "find suitable roles for your degree and profile",
      "identify your skill gaps and what to learn next",
      "suggest career pathways",
      "help you prepare for interviews",
    ],
    ar: [
      "مراجعة سيرتك الذاتية المحفوظة",
      "حساب درجة توافق سيرتك مع أنظمة التوظيف (ATS)",
      "اقتراح وظائف تناسب تخصصك وملفك",
      "تحديد الفجوات في مهاراتك وما ينبغي تعلّمه",
      "اقتراح مسارات مهنية",
      "تجهيزك لمقابلات العمل",
    ],
  },
  advising: {
    en: [
      "show your academic progress",
      "list your remaining requirements",
      "check prerequisites for the courses you want",
      "check your registration readiness",
      "check your graduation readiness",
    ],
    ar: [
      "عرض تقدّمك الأكاديمي",
      "بيان المتطلبات المتبقية",
      "التحقق من المتطلبات السابقة للمقررات",
      "التحقق من جاهزيتك للتسجيل",
      "التحقق من جاهزيتك للتخرج",
    ],
  },
  library: {
    en: [
      "search the library catalogue",
      "find e-books and online access",
      "check library opening hours",
      "explain borrowing and renewals",
      "help you find resources for a course",
    ],
    ar: [
      "البحث في فهرس المكتبة",
      "إيجاد الكتب الإلكترونية والوصول عبر الإنترنت",
      "معرفة ساعات عمل المكتبة",
      "شرح الإعارة والتجديد",
      "مساعدتك في إيجاد مصادر لمقرر معيّن",
    ],
  },
  registration: {
    en: [
      "check your registration readiness",
      "check any active holds on your record",
      "check prerequisites for the courses you want",
      "tell you the status of the registration window",
    ],
    ar: [
      "التحقق من جاهزيتك للتسجيل",
      "التحقق من أي قيود فعّالة على سجلك",
      "التحقق من المتطلبات السابقة للمقررات",
      "بيان حالة فترة التسجيل",
    ],
  },
};

/**
 * The student clearly wants a person: an explicit request, a sensitive or
 * judgement matter, a formal review, or dissatisfaction. Never deflect these.
 */
const HUMAN_RE =
  /\b(still (want|prefer|need)|i (just )?(want|need|prefer) (to (see|speak|talk|meet)|a |an )?(human|person|someone|somebody|advisor|adviser|counsell?or|staff)|speak to (a |someone|somebody)|talk to (a |someone|somebody)|see (someone|somebody|a person)|rather (see|speak|talk|discuss|meet)|in person|face to face|just book( it| the appointment)?|book (it|the appointment|me in)|no,? ?(book|i want)|appeal|formal (review|complaint)|escalate|not (happy|satisfied)|human please)\b|(أريد|أفضل|أحتاج)\s*(أن\s*)?(أقابل|مقابلة|التحدث|أتحدث)|شخص(اً)?|موظف|إنسان|وجهاً لوجه|تظلم|اعتراض رسمي|لست راض|احجز(ه| الموعد)?\s*(فقط)?/i;

const ACCEPT_RE =
  /\b(yes|yeah|yep|sure|ok(ay)?|please do|go ahead|help me( here| first)?|check (my|it)|review (my|it)|do that|sounds good|try (that|it)|show me|start with|first)\b|نعم|أجل|تمام|موافق|حسناً|ساعدني|تفضل|ابدأ|راجع|تحقق|أولاً/i;

/** An explicit human request wins over anything else in the same message. */
export function detectHumanPreference(text: string): boolean {
  return HUMAN_RE.test(text);
}

/** The student took up the offer of AI help. */
export function detectAssistAcceptance(text: string): boolean {
  if (detectHumanPreference(text)) return false;
  return ACCEPT_RE.test(text);
}

/**
 * Matters where routine AI support is not appropriate: sensitive topics,
 * approvals, appeals and dissatisfaction go straight to a person.
 */
export function detectSensitiveMatter(text: string): boolean {
  return /\b(appeal|grievance|harass|discriminat|misconduct|mental health|counsell?ing for stress|depress|anxiety|suicid|abuse|dismissal|probation|exception|waiver|approval|petition|dispute|legal|financial hardship|withdraw(al)? from the university)\b|تظلم|شكوى رسمية|تحرش|تمييز|صحة نفسية|اكتئاب|قلق|إساءة|فصل|استثناء|موافقة عميد|انسحاب من الجامعة/i.test(
    text,
  );
}

function label(domain: AssistDomain, lang: Lang, unitLabel: string | null): string {
  if (unitLabel) return unitLabel;
  const en: Record<AssistDomain, string> = {
    career: "Career Counselling",
    advising: "Academic Advising",
    library: "Library Services",
    registration: "Admission & Registration",
  };
  const ar: Record<AssistDomain, string> = {
    career: "الإرشاد المهني",
    advising: "الإرشاد الأكاديمي",
    library: "خدمات المكتبة",
    registration: "القبول والتسجيل",
  };
  return lang === "ar" ? ar[domain] : en[domain];
}

/** The one-time, friendly offer. Never says "use the AI instead". */
export function buildAssistOffer(
  domain: AssistDomain,
  lang: Lang,
  unitLabel: string | null,
): string {
  const ar = lang === "ar";
  const caps = CAPABILITIES[domain][ar ? "ar" : "en"];
  const name = label(domain, lang, unitLabel);
  return [
    ar
      ? "بكل تأكيد. قبل أن أحجز الموعد، قد أتمكّن من مساعدتك هنا مباشرة."
      : "Absolutely. Before I book that, I may be able to help you right here.",
    ar ? "يمكنني:" : "I can:",
    caps.map((c) => `- ${c}`).join("\n"),
    ar
      ? `هل تحب أن أساعدك بأحدها الآن، أم تفضّل حجز موعد مع ${name}؟`
      : `Would you like me to help with any of these first, or would you still prefer to book a ${name} appointment?`,
  ].join("\n\n");
}

export type AssistDecision =
  | { kind: "offer"; domain: AssistDomain; answer: string; state: AppointmentAssistState }
  | { kind: "accept"; domain: AssistDomain; state: AppointmentAssistState }
  | { kind: "proceed"; state: AppointmentAssistState };

/**
 * Decides, deterministically, whether this appointment turn should first
 * offer Sanadi's own help. Help is offered at most once per conversation and
 * never when the student has asked for a person.
 */
export function decideAppointmentAssist(opts: {
  text: string;
  lang: Lang;
  action: string;
  unitCode: string | null;
  unitLabel?: string | null;
  /** The conversation is already anchored in that domain — AI already helped. */
  anchoredDomain: string | null;
  prior: AppointmentAssistState | null;
}): AssistDecision {
  const { text, lang, action, unitCode, anchoredDomain, prior } = opts;
  const domain = assistDomainForUnit(unitCode);
  const base: AppointmentAssistState = prior ?? {
    unitCode,
    domain,
    appointment_request_origin: "student_request",
    ai_assistance_offered: false,
    ai_assistance_accepted: null,
    ai_resolution_status: "not_offered",
    human_appointment_requested: false,
    human_appointment_booked: false,
    awaitingAssistChoice: false,
    offeredAt: null,
  };

  // The student is answering a previous offer.
  if (prior?.awaitingAssistChoice) {
    if (detectHumanPreference(text) || !detectAssistAcceptance(text)) {
      return {
        kind: "proceed",
        state: {
          ...base,
          unitCode: unitCode ?? base.unitCode,
          awaitingAssistChoice: false,
          ai_assistance_accepted: false,
          ai_resolution_status: "declined",
          human_appointment_requested: true,
        },
      };
    }
    return {
      kind: "accept",
      domain: (prior.domain ?? domain) as AssistDomain,
      state: {
        ...base,
        awaitingAssistChoice: false,
        ai_assistance_accepted: true,
        ai_resolution_status: "ai_assisted",
      },
    };
  }

  const alreadyOffered = base.ai_assistance_offered;
  const humanWanted = detectHumanPreference(text) || detectSensitiveMatter(text);
  // AI already helped in this domain this conversation — do not ask again.
  const aiAlreadyHelped = anchoredDomain !== null && anchoredDomain === domainToAnchor(domain);

  if (
    action !== "book" ||
    !domain ||
    alreadyOffered ||
    humanWanted ||
    aiAlreadyHelped
  ) {
    return {
      kind: "proceed",
      state: {
        ...base,
        unitCode: unitCode ?? base.unitCode,
        domain: domain ?? base.domain,
        human_appointment_requested: true,
        ai_resolution_status: alreadyOffered ? base.ai_resolution_status : "direct_human",
      },
    };
  }

  return {
    kind: "offer",
    domain,
    answer: buildAssistOffer(domain, lang, opts.unitLabel ?? null),
    state: {
      ...base,
      unitCode,
      domain,
      ai_assistance_offered: true,
      ai_resolution_status: "offered",
      awaitingAssistChoice: true,
      offeredAt: new Date().toISOString(),
    },
  };
}

function domainToAnchor(domain: AssistDomain | null): string | null {
  if (domain === "career") return "career";
  if (domain === "library") return "library";
  if (domain === "advising" || domain === "registration") return "academic";
  return null;
}

/** Keywords that clearly name a specific service, not just "an advisor". */
const DOMAIN_KEYWORDS: Record<AssistDomain, RegExp> = {
  career: /(career|cv|resume|job|internship|مهني|سيرة|وظيف)/i,
  advising: /(academic advis|study plan|degree plan|إرشاد أكاديمي|خطة دراسية)/i,
  library: /(librar|book|catalogue|مكتبة|كتاب)/i,
  registration: /(registration|register|admission|enrol|تسجيل|قبول)/i,
};

/**
 * "I still want to see an advisor" continues the service the student already
 * chose; only an explicit mention of a different service switches units.
 */
export function shouldKeepPriorUnit(text: string, priorDomain: AssistDomain | null): boolean {
  if (!priorDomain) return false;
  for (const [domain, re] of Object.entries(DOMAIN_KEYWORDS) as [AssistDomain, RegExp][]) {
    if (domain !== priorDomain && re.test(text)) return false;
  }
  return true;
}
