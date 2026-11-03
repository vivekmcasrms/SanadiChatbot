/**
 * Root-cause aware case classification.
 *
 * Routing must follow the *responsible service*, not the surface wording of the
 * request. "The hostel bus is always late" is a Transportation problem raised by
 * a hostel resident; "my room has no water" is a Housing problem. The classifier
 * therefore derives four independent signals:
 *
 *   interactionType — query | complaint | suggestion | service_request
 *   serviceCode     — the owning service family (housing, transportation, …)
 *   topic           — the concrete subject inside that family
 *   rootCauseCode   — why the student is blocked (financial_hold, system_error, …)
 *
 * Everything is deterministic and bilingual, so the same case always produces the
 * same routing explanation and an owner can see exactly why they received it.
 */

export type ServiceCode =
  | "safety_emergency"
  | "security"
  | "facilities"
  | "housing"
  | "transportation"
  | "registration"
  | "finance"
  | "library"
  | "career_internship"
  | "academic_advising"
  | "it_support"
  | "accessibility"
  | "student_life"
  | "general";

export type Classification = {
  serviceCode: ServiceCode;
  topic: string;
  rootCauseCode: string | null;
  confidence: number;
  reasonEn: string;
  reasonAr: string;
};

type Rule = {
  service: ServiceCode;
  topic: string;
  /** Strong signals that identify the responsible service. */
  match: RegExp;
  /** Optional signals that must NOT be present for this rule to win. */
  unless?: RegExp;
  weight: number;
  en: string;
  ar: string;
};

const SERVICE_LABEL: Record<ServiceCode, { en: string; ar: string }> = {
  safety_emergency: { en: "Operations and Emergency Section", ar: "قسم العمليات والطوارئ" },
  security: { en: "Security and Lost & Found", ar: "الأمن والمفقودات" },
  facilities: { en: "Facilities Management", ar: "إدارة المرافق" },
  housing: { en: "Student Housing Services", ar: "خدمات السكن الطلابي" },
  transportation: { en: "Transportation Services", ar: "خدمات النقل" },
  registration: { en: "Registration Department", ar: "إدارة التسجيل" },
  finance: { en: "Student Accounts", ar: "حسابات الطلبة" },
  library: { en: "Library Services", ar: "خدمات المكتبة" },
  career_internship: { en: "Career and Internship Services", ar: "خدمات المهن والتدريب" },
  academic_advising: { en: "Academic Advising", ar: "الإرشاد الأكاديمي" },
  it_support: { en: "IT Support", ar: "الدعم التقني" },
  accessibility: { en: "Accessibility Support Services", ar: "خدمات دعم ذوي الهمم" },
  student_life: { en: "Student Happiness and Engagement", ar: "سعادة الطلبة والمشاركة" },
  general: { en: "Student Services", ar: "خدمات الطلبة" },
};

/** Service unit codes in `service_units` that own each service family. */
export const SERVICE_UNIT_CODES: Record<ServiceCode, string[]> = {
  safety_emergency: ["OES"],
  security: ["FMD", "SECURITY", "FACILITIES_MANAGEMENT_"],
  facilities: ["FACILITIES_MANAGEMENT_", "FMD"],
  housing: ["HOUSING", "HOUS"],
  transportation: ["TRANS"],
  registration: ["REG", "SAS"],
  finance: ["FEES"],
  library: ["LIB"],
  career_internship: ["CAREER"],
  academic_advising: ["ADV"],
  it_support: ["ITS"],
  accessibility: ["ACCESS"],
  student_life: ["HAPPY", "COMP"],
  general: ["SAS", "COMP"],
};

/** Service families that own an alert, keyed by its verified alert type. */
export const ALERT_SERVICE_CODE: Record<string, ServiceCode> = {
  life_safety: "safety_emergency",
  medical: "safety_emergency",
  security: "security",
  facility: "facilities",
  infrastructure: "facilities",
};

/**
 * Ordered by specificity: safety rules sit at the very top because a live
 * fire/smoke report must never be swallowed by a wording rule, then the
 * transportation rules sit above the generic housing rules so a "hostel bus"
 * case is not swallowed by "hostel".
 */
const RULES: Rule[] = [
  {
    service: "safety_emergency",
    topic: "fire_smoke",
    match:
      /\b(fire|smoke|burning|flames?|explosion|gas leak|fire alarm|evacuat)\b|حريق|دخان|نار|اشتعال|انفجار|تسرب غاز|إخلاء/i,
    weight: 0.99,
    en: "it reports a fire, smoke or life-safety emergency",
    ar: "يبلّغ عن حريق أو دخان أو حالة تهدد السلامة",
  },
  {
    service: "safety_emergency",
    topic: "medical_emergency",
    match:
      /\b(ambulance|bleeding|unconscious|not breathing|collapsed|seizure|heart attack|choking|medical emergency|need(s)? (a )?(doctor|nurse|medical help)|very sick|severe pain|fainted|injured|injury)\b|إسعاف|نزيف|فاقد الوعي|إغماء|لا يتنفس|نوبة|اختناق|طوارئ طبية|مريض جدا|مريضة جدا|أحتاج طبيب|مصاب|إصابة/i,
    weight: 0.97,
    en: "it reports a medical emergency needing immediate response",
    ar: "يبلّغ عن حالة طبية طارئة تتطلب استجابة فورية",
  },
  {
    service: "facilities",
    topic: "electrical_hazard",
    match:
      /\b(electrical (fault|hazard|problem|issue|danger\w*)|exposed wires?|live wires?|sparks?|short circuit|burning smell from|socket is burning)\b|عطل كهربائي|خطر كهربائي|أسلاك مكشوفة|شرارة|تماس كهربائي/i,
    weight: 0.96,
    en: "it reports a dangerous electrical fault",
    ar: "يبلّغ عن عطل كهربائي خطير",
  },
  {
    service: "security",
    topic: "lost_property",
    match:
      /\b(lost|missing|stolen|theft|misplaced|left behind)\b[^.]{0,40}\b(wallet|purse|phone|mobile|laptop|bag|backpack|keys?|card|id|passport|watch|glasses|money|item|property)\b|فقدت|مفقود|ضاع|سرق|سرقة/i,
    // Academic wording such as "missing skills", "lost marks" or "missing
    // credits" is never a lost-property report.
    unless:
      /\b(lost|missing)\s+(\w+\s+){0,2}(skills?|marks?|grades?|credits?|points?|hours?|deadlines?|classes?|lectures?|assignments?|attendance)\b/i,
    weight: 0.95,
    en: "it reports lost, misplaced or stolen property on campus",
    ar: "يبلّغ عن ممتلكات مفقودة أو مسروقة داخل الحرم",
  },
  {
    service: "security",
    topic: "security_incident",
    match:
      /\b(security incident|intruder|suspicious person|threaten\w*|threatening behaviou?r|harassment|vandalism|robbery|assault|unsafe person)\b|حادث أمني|متطفل|شخص مشبوه|تهديد|تحرش|تخريب|سطو|اعتداء/i,
    // "information security", a security course or a password problem is IT, not a campus incident.
    unless: /\b(information security|cyber ?security|security course|security module|security settings|password)\b/i,
    weight: 0.9,
    en: "it reports a campus security incident",
    ar: "يبلّغ عن حادث أمني في الحرم الجامعي",
  },
  {
    service: "facilities",
    topic: "facility_fault",
    match:
      /\b(water (is )?leak|leaking|ceiling|flood|power cut|no electricity|air ?condition\w*|\bac\b|aircon|cooling|elevator|lift) ?\w*\b(?:.{0,30}(not working|broken|out of order|leak))?|تسرب مياه|تسريب|سقف|انقطاع الكهرباء|تكييف|مكيف|مصعد/i,
    unless: /\b(hostel|dorm|dormitory|my room)\b|السكن|غرفتي/i,
    weight: 0.93,
    en: "it reports a building or facility fault",
    ar: "يبلّغ عن عطل في المبنى أو المرافق",
  },
  {
    service: "transportation",
    topic: "bus_service",
    match: /\b(bus|buses|shuttle|transport|transportation|route|driver)\b|حافلة|الحافلات|باص|النقل|مواصلات|سائق/i,
    weight: 0.94,
    en: "the request is about bus or shuttle service",
    ar: "الطلب يتعلق بخدمة الحافلات أو النقل",
  },
  {
    service: "transportation",
    topic: "parking",
    match: /\bparking|car park|permit\b/i,
    weight: 0.9,
    en: "the request is about parking",
    ar: "الطلب يتعلق بمواقف السيارات",
  },
  {
    service: "housing",
    topic: "maintenance",
    match:
      /\b(room|hostel|dorm|dormitory)\b.*\b(broken|leak|water|air ?condition|ac\b|cleaning|maintenance|repair|pest)|صيانة|تكييف|تسريب|نظافة/i,
    weight: 0.92,
    en: "it reports a maintenance problem inside student accommodation",
    ar: "يبلّغ عن مشكلة صيانة داخل السكن الطلابي",
  },
  {
    service: "housing",
    topic: "allocation",
    match: /\b(hostel|housing|dorm|dormitory|room|bed|roommate|accommodation)\b|السكن|الغرفة|سرير|زميل الغرفة/i,
    weight: 0.88,
    en: "it concerns hostel accommodation or room allocation",
    ar: "يتعلق بالسكن الطلابي أو تخصيص الغرف",
  },
  {
    service: "finance",
    topic: "financial_hold",
    match: /\b(financial hold|unpaid|outstanding balance|tuition|fee|fees|payment|invoice|refund)\b|رسوم|دفع|مالي|فاتورة|استرداد/i,
    weight: 0.9,
    en: "it involves fees, payments or a financial hold",
    ar: "يتعلق بالرسوم أو المدفوعات أو حجز مالي",
  },
  {
    service: "registration",
    topic: "registration_block",
    match: /\b(register|registration|enrol|enroll|add ?\/? ?drop|withdraw|withdrawal|section|hold|schedule|course)\b|تسجيل|انسحاب|شعبة|مقرر|حجز أكاديمي/i,
    weight: 0.86,
    en: "it concerns course registration or an enrolment restriction",
    ar: "يتعلق بتسجيل المقررات أو قيد على التسجيل",
  },
  {
    service: "career_internship",
    topic: "internship",
    match: /\b(internship|training|placement|cv|resume|career|employer|job)\b|تدريب|السيرة الذاتية|مهني|وظيفة/i,
    weight: 0.88,
    en: "it concerns internships, placement or career support",
    ar: "يتعلق بالتدريب أو التنسيب أو الدعم المهني",
  },
  {
    service: "library",
    topic: "library",
    match: /\b(library|book|borrow|catalogue|catalog|database|journal|study room)\b|مكتبة|كتاب|استعارة|قاعدة بيانات/i,
    weight: 0.88,
    en: "it concerns library resources or services",
    ar: "يتعلق بمصادر المكتبة أو خدماتها",
  },
  {
    service: "it_support",
    topic: "system_error",
    match: /\b(portal|system|website|login|password|error|blackboard|wifi|wi-?fi|network|email account)\b|النظام|البوابة|كلمة المرور|خطأ|الشبكة/i,
    weight: 0.84,
    en: "a university system or account is failing",
    ar: "يوجد خلل في نظام أو حساب جامعي",
  },
  {
    service: "academic_advising",
    topic: "advising",
    match: /\b(advisor|advising|study plan|graduation plan|gpa|major|transfer)\b|مرشد|الخطة الدراسية|المعدل|التخصص|التحويل/i,
    weight: 0.82,
    en: "it concerns academic advising or study planning",
    ar: "يتعلق بالإرشاد الأكاديمي أو الخطة الدراسية",
  },
  {
    service: "accessibility",
    topic: "accessibility",
    match: /\b(disab|accessib|wheelchair|special needs|assistive)\b|ذوي الهمم|إعاقة|كرسي متحرك/i,
    weight: 0.9,
    en: "it concerns accessibility support",
    ar: "يتعلق بدعم ذوي الهمم",
  },
  {
    service: "student_life",
    topic: "student_life",
    match: /\b(club|activity|event|cafeteria|food|sport|gym|prayer)\b|نادي|فعالية|كافتيريا|رياضة|مصلى/i,
    weight: 0.8,
    en: "it concerns campus life, facilities or activities",
    ar: "يتعلق بالحياة الجامعية أو المرافق أو الأنشطة",
  },
];

/** Why the student is blocked — drives the sub-routing inside a service family. */
const ROOT_CAUSES: { code: string; match: RegExp; en: string; ar: string }[] = [
  {
    code: "financial_hold",
    match: /\b(financial hold|unpaid|outstanding|balance|fees? (due|unpaid)|payment)\b|حجز مالي|رسوم غير مدفوعة|مستحقات/i,
    en: "an unpaid balance is blocking the student",
    ar: "رصيد مالي غير مسدد يمنع الطالب",
  },
  {
    code: "academic_hold",
    match: /\b(academic hold|probation|gpa|prerequisite|advisor approval)\b|حجز أكاديمي|إنذار|المتطلب السابق|موافقة المرشد/i,
    en: "an academic restriction is blocking the student",
    ar: "قيد أكاديمي يمنع الطالب",
  },
  {
    code: "system_error",
    match: /\b(error|not working|cannot|can'?t|fails?|crash|blank page|timeout)\b|لا يعمل|خطأ|لا أستطيع|تعطل/i,
    en: "a system failure is preventing the student from proceeding",
    ar: "خلل في النظام يمنع الطالب من المتابعة",
  },
  {
    code: "capacity",
    match: /\b(full|no seats?|no beds?|waitlist|capacity|unavailable)\b|ممتلئ|لا توجد مقاعد|قائمة انتظار|السعة/i,
    en: "the requested resource is at capacity",
    ar: "المورد المطلوب ممتلئ",
  },
  {
    code: "service_quality",
    match: /\b(late|delay|rude|dirty|slow|no response|ignored|repeatedly)\b|تأخر|تأخير|بطيء|قذر|لا يوجد رد|تجاهل/i,
    en: "the student reports a recurring service-quality problem",
    ar: "الطالب يبلّغ عن مشكلة متكررة في جودة الخدمة",
  },
  {
    code: "missing_information",
    match: /\b(how do i|what is|where can|when will|eligib)\b|كيف|ما هي|أين|متى|الأهلية/i,
    en: "the student needs information or guidance",
    ar: "الطالب يحتاج معلومة أو إرشاد",
  },
];

const SUGGESTION_HINTS = /\b(suggest|propose|recommend|it would be better|please add|increase the number)\b|أقترح|اقتراح|يُفضل|يرجى إضافة|زيادة عدد/i;
const COMPLAINT_HINTS = /\b(complain|unacceptable|unfair|disappointed|repeatedly|again and again|nobody)\b|شكوى|غير مقبول|غير عادل|مستاء|مراراً/i;
const REQUEST_HINTS = /\b(apply|request|i need|issue me|please provide|book|reserve)\b|أطلب|أرغب|أحتاج|إصدار|حجز/i;

export function detectInteractionType(text: string, fallback: string): string {
  if (SUGGESTION_HINTS.test(text)) return "suggestion";
  if (COMPLAINT_HINTS.test(text)) return "complaint";
  if (REQUEST_HINTS.test(text)) return "service_request";
  return fallback || "query";
}

/** Deterministic service / topic / root-cause classification for one case. */
export function classifyForRouting(input: {
  title: string;
  description?: string | null;
  caseType?: string | null;
}): Classification {
  const text = `${input.title}\n${input.description ?? ""}`;

  const hits = RULES.filter((r) => r.match.test(text) && !(r.unless && r.unless.test(text)));
  const best = hits.sort((a, b) => b.weight - a.weight)[0];
  const rootCause = ROOT_CAUSES.find((rc) => rc.match.test(text)) ?? null;

  const service = best?.service ?? "general";
  const topic = best?.topic ?? "general";

  // Two families claiming the same case means the wording is genuinely mixed,
  // so we lower confidence and let the owner see it as "verify routing".
  const competing = new Set(hits.map((h) => h.service));
  const confidence = best ? Math.max(0.5, best.weight - (competing.size > 1 ? 0.15 : 0)) : 0.45;

  const label = SERVICE_LABEL[service];
  const why = best?.en ?? "no specific service signal was found in the request";
  const whyAr = best?.ar ?? "لم يتم العثور على إشارة واضحة لخدمة معينة";

  return {
    serviceCode: service,
    topic,
    rootCauseCode: rootCause?.code ?? null,
    confidence: Math.round(confidence * 100) / 100,
    reasonEn: `Routed to ${label.en} because ${why}${rootCause ? `, and ${rootCause.en}` : ""}.`,
    reasonAr: `تم التوجيه إلى ${label.ar} لأن ${whyAr}${rootCause ? `، و${rootCause.ar}` : ""}.`,
  };
}

export function serviceLabel(code: string): { en: string; ar: string } {
  return SERVICE_LABEL[(code as ServiceCode) ?? "general"] ?? SERVICE_LABEL.general;
}
