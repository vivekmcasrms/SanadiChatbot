/**
 * Proactive services — services that no longer need a student request.
 *
 * Campus entry permits are now proactive: the UAEU ID card opens the gate, so
 * the Assistant answers deterministically with the approved wording and never
 * opens a case, routes to a Service Owner or asks for a form.
 */
import type { Lang } from "../agent-types";

export const PROACTIVE_CAMPUS_ENTRY = {
  serviceCode: "SVC-CAMPUS-ENTRY",
  en: "**Good news — your campus access is already taken care of.**\n\nYou no longer need to submit a separate request or wait for approval.\n\nSimply proceed to the designated parking area and use your UAEU ID to access the gate.\n\n**Nothing else is required from you — you're all set.**",
  ar: "**خبر سار — تم تسهيل دخولك إلى الحرم الجامعي مسبقاً.**\n\nلم تعد بحاجة إلى تقديم طلب منفصل أو انتظار الموافقة.\n\nيمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات للدخول عبر البوابة.\n\n**لا يلزمك اتخاذ أي إجراء إضافي — كل شيء جاهز لك.**",
  nameEn: "Campus entry permit (proactive)",
  nameAr: "تصريح دخول الحرم الجامعي (خدمة استباقية)",
} as const;

/** The proactive access didn't work (ID rejected, gate won't open). */
export const CAMPUS_ACCESS_PROBLEM = {
  en: "Sorry about that — your UAEU ID should open the gate without any extra request.\n\nPlease try your card at another gate reader first. If it still doesn't open, visit the Security Office on campus with your UAEU ID and they will check your access on the spot.\n\nWould you like me to report this to the Security team so they can check your card access?",
  ar: "نعتذر عن ذلك — من المفترض أن تفتح بطاقة الهوية الجامعية الخاصة بجامعة الإمارات البوابة دون أي طلب إضافي.\n\nيرجى تجربة البطاقة على قارئ بوابة آخر أولاً. وإذا لم تفتح البوابة بعد، توجه إلى مكتب الأمن في الحرم الجامعي مع بطاقتك الجامعية وسيتحققون من صلاحية الدخول فوراً.\n\nهل تريد أن أبلّغ فريق الأمن ليتمكنوا من التحقق من صلاحية بطاقتك؟",
} as const;

/**
 * Library membership is proactive: enrolment activates borrowing privileges,
 * so there is no library registration form to submit.
 */
export const PROACTIVE_LIBRARY_ACCESS = {
  serviceCode: "SVC-LIB-ACCESS",
  en: "**Good news — your library access is already taken care of.**\n\nYour library membership was activated automatically with your enrolment, so there is no registration form and nothing to wait for.\n\nSimply use your UAEU ID to borrow books at the library, and sign in with your university account to access e-books and online resources.\n\n**Nothing else is required from you — you're all set.**",
  ar: "**خبر سار — تم تفعيل عضويتك في المكتبة مسبقاً.**\n\nتم تفعيل عضويتك في المكتبة تلقائياً مع تسجيلك في الجامعة، فلا توجد استمارة تسجيل ولا شيء بانتظار الموافقة.\n\nيمكنك استخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لاستعارة الكتب من المكتبة، وتسجيل الدخول بحسابك الجامعي للوصول إلى الكتب والمصادر الإلكترونية.\n\n**لا يلزمك اتخاذ أي إجراء إضافي — كل شيء جاهز لك.**",
  nameEn: "Library membership (proactive)",
  nameAr: "عضوية المكتبة (خدمة استباقية)",
} as const;

/**
 * Health insurance is proactive: enrolled students are covered automatically,
 * so there is no separate insurance enrolment request.
 */
export const PROACTIVE_HEALTH_INSURANCE = {
  serviceCode: "SVC-HEALTH-INS",
  en: "**Good news — your health insurance is already taken care of.**\n\nAs an enrolled UAEU student you are automatically covered by the university health insurance, so there is no separate application to submit and nothing to wait for.\n\nSimply present your UAEU ID when you visit the clinic or a network provider.\n\n**Nothing else is required from you — you're all set.**",
  ar: "**خبر سار — تم ترتيب تأمينك الصحي مسبقاً.**\n\nبصفتك طالباً مسجلاً في جامعة الإمارات، أنت مشمول تلقائياً بالتأمين الصحي الجامعي، فلا يوجد طلب منفصل لتقديمه ولا شيء بانتظار الموافقة.\n\nيكفي أن تُظهر بطاقة الهوية الجامعية الخاصة بجامعة الإمارات عند زيارة العيادة أو أحد مقدمي الخدمة المعتمدين.\n\n**لا يلزمك اتخاذ أي إجراء إضافي — كل شيء جاهز لك.**",
  nameEn: "Health insurance (proactive)",
  nameAr: "التأمين الصحي (خدمة استباقية)",
} as const;

/**
 * The student ID card is proactive: it is issued automatically after
 * enrolment, so there is no application form for the card itself.
 */
export const PROACTIVE_STUDENT_ID = {
  serviceCode: "SVC-STUDENT-ID",
  en: "**Good news — your student ID is already taken care of.**\n\nYour UAEU ID card is issued automatically once your enrolment is confirmed, so there is no application form and nothing to wait for.\n\nYour card already works for campus gates, the library, and printing — no activation request is needed.\n\n**Nothing else is required from you — you're all set.**",
  ar: "**خبر سار — تم ترتيب بطاقتك الجامعية مسبقاً.**\n\nتُصدر بطاقة الهوية الجامعية الخاصة بجامعة الإمارات تلقائياً فور تأكيد تسجيلك، فلا توجد استمارة تقديم ولا شيء بانتظار الموافقة.\n\nبطاقتك تعمل مباشرة على بوابات الحرم الجامعي وفي المكتبة وللطباعة — دون الحاجة إلى أي طلب تفعيل.\n\n**لا يلزمك اتخاذ أي إجراء إضافي — كل شيء جاهز لك.**",
  nameEn: "Student ID card (proactive)",
  nameAr: "البطاقة الجامعية (خدمة استباقية)",
} as const;

/** Words that mean "coming onto campus / through the gate / into parking". */
const ACCESS_RE =
  /\b(entry|enter|entrance|access|gate|barrier|parking|car ?park|vehicle|car|drive in|driving in)\b|دخول|الدخول|بوابة|البوابة|حاجز|موقف|مواقف|مركبة|المركبة|سيارة|سيارتي/i;

const PERMIT_RE =
  /\b(permit|permits|pass|sticker|badge|tag|clearance|authoris|authoriz|apply|application|request|need|require|how do i)\b|تصريح|تصاريح|ملصق|بطاقة دخول|تسجيل|طلب|أطلب|كيف/i;

const CAMPUS_RE = /\b(campus|university|uaeu|gate|parking|car ?park)\b|الحرم|الجامعة|جامعة الإمارات|البوابة|موقف|مواقف/i;

/** True when the message is about getting a vehicle or person onto campus. */
export function isCampusEntryPermitQuestion(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (!ACCESS_RE.test(text)) return false;
  // A bare "access" or "gate" word is not enough: the turn must also read like
  // a permit / entry question about campus.
  const explicitPermit =
    /\b(entry permit|campus (entry|access)|parking (permit|access|pass)|vehicle (permit|access|pass)|gate (access|pass|permit))\b/i.test(
      text,
    ) || /تصريح\s*(دخول)?|دخول (الحرم|الجامعة)|تصريح المواقف/i.test(text);
  if (explicitPermit) return true;
  return PERMIT_RE.test(text) && CAMPUS_RE.test(text);
}

const PROBLEM_RE =
  /\b(not work\w*|doesn't work|didn't work|won't \w*open\w*|not \w*open\w*|didn't \w*open\w*|can't \w*open\w*|cannot \w*open\w*|declined|rejected|denied|failed|problem|issue|error|stuck|broken)\b|لا تعمل|لم تعمل|لا تفتح|لم تفتح|لا يفتح|لا يعمل|مشكلة|تعذر|مرفوضة|لا تستجيب/i;

/** True when the student reports that the proactive access failed. */
export function isCampusAccessProblem(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return PROBLEM_RE.test(text) && (ACCESS_RE.test(text) || /uaeu id|id card|بطاقة|الهوية الجامعية/i.test(text));
}

export function proactiveCampusEntryAnswer(lang: Lang): string {
  return lang === "ar" ? PROACTIVE_CAMPUS_ENTRY.ar : PROACTIVE_CAMPUS_ENTRY.en;
}

export function campusAccessProblemAnswer(lang: Lang): string {
  return lang === "ar" ? CAMPUS_ACCESS_PROBLEM.ar : CAMPUS_ACCESS_PROBLEM.en;
}
