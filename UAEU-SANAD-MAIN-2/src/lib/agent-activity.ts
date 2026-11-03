/**
 * Student-facing activity vocabulary.
 *
 * Two jobs, both deliberately non-technical:
 *  1. `resolveStage` picks the ONE meaningful stage shown while Sanadi works,
 *     so the student never sees an internal hand-off sequence.
 *  2. `buildActivitySteps` turns the tools that actually executed in a turn
 *     into a short, plain-language "What Sanadi did" list. Nothing here is
 *     invented: a step only appears when its tool really ran.
 *
 * Client-safe: no server imports, no model or provider details.
 */
import type { Lang } from "./agent-types";

export type AgentStage =
  | "registration"
  | "academic"
  | "graduation"
  | "holds"
  | "career"
  | "library"
  | "textbook"
  | "document"
  | "appointment"
  | "cases"
  | "alerts"
  | "complaint"
  | "suggestion"
  | "alert_report"
  | "emergency"
  | "action_plan"
  | "resolve"
  | "knowledge"
  | "routing";

type AgentEntry = { nameEn: string; nameAr: string; en: string; ar: string };

const STAGE_LABELS: Record<AgentStage, AgentEntry> = {
  registration: {
    nameEn: "Registration Readiness Agent",
    nameAr: "وكيل جاهزية التسجيل",
    en: "Registration Readiness Agent is checking your academic record and registration blockers…",
    ar: "وكيل جاهزية التسجيل يراجع سجلك الأكاديمي وأي عوائق للتسجيل…",
  },
  academic: {
    nameEn: "Academic Progress Agent",
    nameAr: "وكيل التقدم الأكاديمي",
    en: "Academic Progress Agent is checking your academic record…",
    ar: "وكيل التقدم الأكاديمي يراجع سجلك الأكاديمي…",
  },
  graduation: {
    nameEn: "Graduation Readiness Agent",
    nameAr: "وكيل جاهزية التخرج",
    en: "Graduation Readiness Agent is checking your degree requirements…",
    ar: "وكيل جاهزية التخرج يراجع متطلبات تخرجك…",
  },
  holds: {
    nameEn: "Hold Resolution Agent",
    nameAr: "وكيل معالجة الإيقافات",
    en: "Hold Resolution Agent is checking the holds on your record…",
    ar: "وكيل معالجة الإيقافات يراجع الإيقافات على سجلك…",
  },
  career: {
    nameEn: "Career Counselling Agent",
    nameAr: "وكيل الإرشاد المهني",
    en: "Career Counselling Agent is reviewing your career profile…",
    ar: "وكيل الإرشاد المهني يراجع ملفك المهني…",
  },
  library: {
    nameEn: "Library Agent",
    nameAr: "وكيل المكتبة",
    en: "Library Agent is searching the catalogue…",
    ar: "وكيل المكتبة يبحث في الفهرس…",
  },
  textbook: {
    nameEn: "Course Textbook Agent",
    nameAr: "وكيل الكتب الدراسية",
    en: "Course Textbook Agent is checking your course materials…",
    ar: "وكيل الكتب الدراسية يراجع مواد مقرراتك…",
  },
  document: {
    nameEn: "Document Generation Agent",
    nameAr: "وكيل إنشاء الوثائق",
    en: "Document Generation Agent is preparing your letter…",
    ar: "وكيل إنشاء الوثائق يجهّز خطابك…",
  },
  appointment: {
    nameEn: "Appointment Agent",
    nameAr: "وكيل المواعيد",
    en: "Appointment Agent is checking real availability…",
    ar: "وكيل المواعيد يتحقق من الأوقات المتاحة فعلياً…",
  },
  cases: {
    nameEn: "Case Management Agent",
    nameAr: "وكيل إدارة الطلبات",
    en: "Case Management Agent is checking your requests and their progress…",
    ar: "وكيل إدارة الطلبات يراجع طلباتك وحالتها…",
  },
  alerts: {
    nameEn: "Notifications Agent",
    nameAr: "وكيل الإشعارات",
    en: "Notifications Agent is checking your notifications…",
    ar: "وكيل الإشعارات يراجع تنبيهاتك…",
  },
  complaint: {
    nameEn: "Complaint Agent",
    nameAr: "وكيل الشكاوى",
    en: "Complaint Agent is preparing your complaint…",
    ar: "وكيل الشكاوى يجهّز شكواك…",
  },
  suggestion: {
    nameEn: "Suggestion Agent",
    nameAr: "وكيل الاقتراحات",
    en: "Suggestion Agent is recording your suggestion…",
    ar: "وكيل الاقتراحات يسجّل اقتراحك…",
  },
  alert_report: {
    nameEn: "Alert Agent",
    nameAr: "وكيل البلاغات",
    en: "Alert Agent is checking the correct unit to contact…",
    ar: "وكيل البلاغات يحدد الجهة المختصة للتواصل…",
  },
  emergency: {
    nameEn: "Emergency & Safety Agent",
    nameAr: "وكيل الطوارئ والسلامة",
    en: "Emergency & Safety Agent is retrieving the official emergency contacts…",
    ar: "وكيل الطوارئ والسلامة يجلب جهات الطوارئ الرسمية…",
  },
  action_plan: {
    nameEn: "Student Action Plan Agent",
    nameAr: "وكيل خطة العمل الطلابية",
    en: "Student Action Plan Agent is building your priorities…",
    ar: "وكيل خطة العمل الطلابية يعدّ أولوياتك…",
  },
  resolve: {
    nameEn: "Resolve This for Me Agent",
    nameAr: "وكيل حل المشكلة نيابةً عنك",
    en: "Resolve This for Me Agent is working through your issue…",
    ar: "وكيل حل المشكلة نيابةً عنك يعالج مسألتك…",
  },
  knowledge: {
    nameEn: "Knowledge Agent",
    nameAr: "وكيل المعرفة",
    en: "Knowledge Agent is checking the official university sources…",
    ar: "وكيل المعرفة يراجع المصادر الرسمية للجامعة…",
  },
  routing: {
    nameEn: "Case Management Agent",
    nameAr: "وكيل إدارة الطلبات",
    en: "Case Management Agent is routing your request to the appropriate team…",
    ar: "وكيل إدارة الطلبات يوجّه طلبك إلى الجهة المختصة…",
  },
};

export function stageLabel(stage: AgentStage, lang: Lang): string {
  const entry = STAGE_LABELS[stage];
  return lang === "ar" ? entry.ar : entry.en;
}

/** The student-facing agent name for a stage, in the conversation language. */
export function agentDisplayName(stage: AgentStage, lang: Lang): string {
  const entry = STAGE_LABELS[stage];
  return lang === "ar" ? entry.nameAr : entry.nameEn;
}

export function isAgentStage(value: unknown): value is AgentStage {
  return typeof value === "string" && value in STAGE_LABELS;
}

const REGISTRATION_RE =
  /\b(register|registration|registering|enrol|enroll|timetable|credit load)\b|(التسجيل|أسجل|اسجل|الجدول|الساعات)/i;
const HOLD_RE = /\b(hold|holds|blocked|block on my)\b|(إيقاف|ايقاف|حظر|قيد على)/i;
const GRADUATION_RE =
  /\b(graduat|degree audit|remaining credit|study plan)\b|(تخرج|الخطة الدراسية|الساعات المتبقية)/i;
const TEXTBOOK_RE = /\b(textbook|course book|prescribed book|blackboard)\b|(الكتاب المقرر|الكتب المقررة|بلاك ?بورد)/i;
const ACTION_PLAN_RE =
  /\b(what should i do|my priorities|action plan|what do i need to do|plan for me)\b|(ماذا أفعل|أولوياتي|خطة عمل)/i;
const RESOLVE_RE = /\b(resolve this|fix this for me|sort this out|handle this for me)\b|(حل هذه|عالج هذا نيابة)/i;

/**
 * The single stage worth showing. Order matters: the explicit intent of the
 * CURRENT message always wins, so the label can never be inherited from an
 * earlier turn's domain.
 */
export function resolveStage(
  message: string,
  domains: string[],
  opts: {
    complaint?: boolean;
    emergency?: boolean;
    suggestion?: boolean;
    alert?: boolean;
  } = {},
): AgentStage {
  if (opts.emergency) return "emergency";
  if (opts.alert) return "alert_report";
  if (opts.suggestion) return "suggestion";
  if (opts.complaint) return "complaint";
  if (RESOLVE_RE.test(message)) return "resolve";
  const has = (d: string) => domains.includes(d);
  if (has("appointments")) return "appointment";
  if (has("document")) return "document";
  if (has("library")) return TEXTBOOK_RE.test(message) ? "textbook" : "library";
  if (has("career")) return "career";
  if (has("academic")) {
    if (HOLD_RE.test(message)) return "holds";
    if (REGISTRATION_RE.test(message)) return "registration";
    if (GRADUATION_RE.test(message)) return "graduation";
    return "academic";
  }
  if (has("cases")) return "cases";
  if (has("alerts")) return "alerts";
  if (ACTION_PLAN_RE.test(message)) return "action_plan";
  if (HOLD_RE.test(message)) return "holds";
  if (REGISTRATION_RE.test(message)) return "registration";
  return "knowledge";
}


/**
 * Tool → plain-language step. Tools without an entry are intentionally hidden:
 * a student gains nothing from an internal lookup they cannot act on.
 */
const TOOL_STEPS: Record<string, { en: string; ar: string }> = {
  get_student_academic_status: { en: "Checked your student record", ar: "راجعت سجلك الطلابي" },
  get_my_identity: { en: "Checked your student record", ar: "راجعت سجلك الطلابي" },
  get_my_courses: { en: "Checked your courses", ar: "راجعت موادك" },
  get_academic_progress: { en: "Checked your degree progress", ar: "راجعت تقدمك نحو التخرج" },
  get_graduation_progress: { en: "Checked your degree progress", ar: "راجعت تقدمك نحو التخرج" },
  get_course_prerequisites: { en: "Checked course prerequisites", ar: "راجعت المتطلبات السابقة للمواد" },
  get_prerequisite_status: { en: "Checked your prerequisites", ar: "راجعت متطلباتك السابقة" },
  get_course_eligibility: { en: "Checked your course eligibility", ar: "راجعت أهليتك للمواد" },
  check_registration_eligibility: { en: "Checked your registration status", ar: "راجعت حالة تسجيلك" },
  check_registration_readiness: { en: "Checked your registration status", ar: "راجعت حالة تسجيلك" },
  get_student_status: { en: "Checked your enrolment status", ar: "راجعت حالة قيدك" },
  get_registration_window: { en: "Checked the registration period", ar: "راجعت فترة التسجيل" },
  get_student_holds: { en: "Checked active holds", ar: "راجعت الإيقافات النشطة" },
  get_active_holds: { en: "Checked active holds", ar: "راجعت الإيقافات النشطة" },
  get_hold_details: { en: "Checked active holds", ar: "راجعت الإيقافات النشطة" },
  get_hold_resolution_status: { en: "Checked progress on your hold", ar: "راجعت تقدم معالجة الإيقاف" },
  open_hold_resolution_case: { en: "Opened a request to resolve the hold", ar: "فتحت طلباً لمعالجة الإيقاف" },
  search_knowledge_base: { en: "Checked official university sources", ar: "راجعت المصادر الرسمية للجامعة" },
  get_university_facts: { en: "Checked official university information", ar: "راجعت معلومات الجامعة الرسمية" },
  get_emergency_contact: { en: "Retrieved official emergency contacts", ar: "جلبت جهات الطوارئ الرسمية" },
  find_university_service: { en: "Identified the responsible team", ar: "حدّدت الجهة المسؤولة" },
  get_my_cases: { en: "Checked your requests", ar: "راجعت طلباتك" },
  get_case_result: { en: "Checked the outcome of your request", ar: "راجعت نتيجة طلبك" },
  add_case_information: { en: "Added your information to the request", ar: "أضفت معلوماتك إلى الطلب" },
  modify_case_request: { en: "Updated your request", ar: "حدّثت طلبك" },
  raise_case_review: { en: "Raised a review of the decision", ar: "رفعت طلب مراجعة للقرار" },
  find_my_university_records: { en: "Checked your university documents", ar: "راجعت وثائقك الجامعية" },
  get_my_alerts: { en: "Checked your notifications", ar: "راجعت تنبيهاتك" },
  mark_alert_read: { en: "Updated your notifications", ar: "حدّثت تنبيهاتك" },
  list_appointment_slots: { en: "Checked real appointment availability", ar: "راجعت المواعيد المتاحة فعلياً" },
  get_my_appointments: { en: "Checked your appointments", ar: "راجعت مواعيدك" },
  book_appointment: { en: "Booked your appointment", ar: "حجزت موعدك" },
  cancel_appointment: { en: "Cancelled your appointment", ar: "ألغيت موعدك" },
  reschedule_appointment: { en: "Moved your appointment", ar: "نقلت موعدك" },
  create_complaint: { en: "Opened a request with the responsible team", ar: "فتحت طلباً لدى الجهة المسؤولة" },
  create_suggestion: { en: "Recorded your suggestion", ar: "سجّلت اقتراحك" },
  report_alert: { en: "Reported the incident", ar: "بلّغت عن الحادثة" },
  escalate_to_human: { en: "Routed your request to a staff member", ar: "حوّلت طلبك إلى موظف مختص" },
  get_career_cv_status: { en: "Checked your CV", ar: "راجعت سيرتك الذاتية" },
  analyze_career_fit: { en: "Matched you to career roles", ar: "طابقت ملفك مع الوظائف" },
  get_ats_score: { en: "Scored your CV", ar: "قيّمت سيرتك الذاتية" },
  generate_career_action_plan: { en: "Built your career action plan", ar: "أعددت خطة عملك المهنية" },
  review_my_cv: { en: "Reviewed your CV", ar: "راجعت سيرتك الذاتية" },
  get_interview_preparation: { en: "Prepared interview guidance", ar: "أعددت إرشادات المقابلة" },
  request_career_counsellor: { en: "Requested a career counsellor", ar: "طلبت مرشداً مهنياً" },
  check_enrollment_letter_readiness: { en: "Checked your letter eligibility", ar: "راجعت أهليتك للخطاب" },
  issue_enrollment_letter: { en: "Issued your official letter", ar: "أصدرت خطابك الرسمي" },
  check_service_availability: { en: "Checked service availability", ar: "راجعت توفر الخدمة" },
  set_service_reminder: { en: "Set your reminder", ar: "ضبطت تذكيرك" },
  get_library_hours: { en: "Checked library opening hours", ar: "راجعت ساعات عمل المكتبة" },
  get_library_service_info: { en: "Checked library services", ar: "راجعت خدمات المكتبة" },
  search_library_catalogue: { en: "Searched the library catalogue", ar: "بحثت في فهرس المكتبة" },
  search_course_textbooks: {
    en: "Checked the library catalogue for your course textbooks",
    ar: "تحققت من فهرس المكتبة لكتب مقرراتك",
  },
  build_library_citation: { en: "Built your citation", ar: "أعددت الاقتباس المرجعي" },
  ask_a_librarian: { en: "Sent your question to a librarian", ar: "أرسلت سؤالك إلى أمين المكتبة" },
  get_proactive_service: { en: "Checked official university information", ar: "راجعت معلومات الجامعة الرسمية" },
  greeting: { en: "Replied with a friendly greeting", ar: "ردّ بتحية ودّية" },
};

/**
 * The "What Sanadi did" list.
 * Prefers student-facing sentences the server already wrote from core logic;
 * falls back to mapping tool ids (Node / history that only stored tools).
 * Duplicated wording is collapsed and the list is capped so it stays readable.
 */
export function buildActivitySteps(items: string[], lang: Lang): string[] {
  const steps: string[] = [];

  for (const name of items) {
    if (!name || name === "none") continue;
    if (TOOL_STEPS[name]) continue;
    if (/\s/.test(name) || /[\u0600-\u06FF]/.test(name)) {
      if (!steps.includes(name)) steps.push(name);
    }
  }
  if (steps.length) return steps.slice(0, 8);

  for (const name of items) {
    if (!name || name === "none") continue;
    const entry = TOOL_STEPS[name];
    if (!entry) continue;
    const label = lang === "ar" ? entry.ar : entry.en;
    if (!steps.includes(label)) steps.push(label);
  }
  return steps.slice(0, 8);
}
