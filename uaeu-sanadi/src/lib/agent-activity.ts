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

/**
 * Component kinds. Only the Sanadi Orchestrator is an AI agent; everything it
 * calls is a specialist service, rule engine, workflow, retrieval service or
 * skill. Agent decides · workflow coordinates · rule engine verifies · tool executes.
 */
export type ComponentKind = "service" | "rule" | "workflow" | "retrieval" | "skill";

export const COMPONENT_KIND_LABELS: Record<ComponentKind, { en: string; ar: string }> = {
  service: { en: "Specialist Service", ar: "خدمة متخصصة" },
  rule: { en: "Rule Engine", ar: "محرك قواعد" },
  workflow: { en: "Workflow", ar: "مسار عمل" },
  retrieval: { en: "Retrieval Service", ar: "خدمة استرجاع" },
  skill: { en: "Skill", ar: "مهارة" },
};

type AgentEntry = { kind: ComponentKind; nameEn: string; nameAr: string; en: string; ar: string };

const STAGE_LABELS: Record<AgentStage, AgentEntry> = {
  registration: {
    kind: "rule",
    nameEn: "Registration Readiness Rule Engine",
    nameAr: "محرك قواعد جاهزية التسجيل",
    en: "Sanadi is checking your registration readiness…",
    ar: "سندي يتحقق من جاهزيتك للتسجيل…",
  },
  academic: {
    kind: "service",
    nameEn: "Academic Progress Service",
    nameAr: "خدمة التقدم الأكاديمي",
    en: "Sanadi is checking your academic record…",
    ar: "سندي يراجع سجلك الأكاديمي…",
  },
  graduation: {
    kind: "rule",
    nameEn: "Graduation Readiness Rule Engine",
    nameAr: "محرك قواعد جاهزية التخرج",
    en: "Sanadi is checking your degree requirements…",
    ar: "سندي يراجع متطلبات تخرجك…",
  },
  holds: {
    kind: "service",
    nameEn: "Hold Resolution Service",
    nameAr: "خدمة معالجة الإيقافات",
    en: "Sanadi is checking the holds on your record…",
    ar: "سندي يراجع الإيقافات على سجلك…",
  },
  career: {
    kind: "service",
    nameEn: "Career Counselling Service",
    nameAr: "خدمة الإرشاد المهني",
    en: "Sanadi is reviewing your career profile…",
    ar: "سندي يراجع ملفك المهني…",
  },
  library: {
    kind: "service",
    nameEn: "Library Search Service",
    nameAr: "خدمة البحث في المكتبة",
    en: "Sanadi is searching the library catalogue…",
    ar: "سندي يبحث في فهرس المكتبة…",
  },
  textbook: {
    kind: "service",
    nameEn: "Course Textbook Service",
    nameAr: "خدمة الكتب الدراسية",
    en: "Sanadi is checking your course materials…",
    ar: "سندي يراجع مواد مقرراتك…",
  },
  document: {
    kind: "workflow",
    nameEn: "Document Issuance Workflow",
    nameAr: "مسار إصدار الوثائق",
    en: "Sanadi is preparing your letter…",
    ar: "سندي يجهّز خطابك…",
  },
  appointment: {
    kind: "workflow",
    nameEn: "Appointment Booking Workflow",
    nameAr: "مسار حجز المواعيد",
    en: "Sanadi is checking real appointment availability…",
    ar: "سندي يتحقق من المواعيد المتاحة فعلياً…",
  },
  cases: {
    kind: "workflow",
    nameEn: "Case Management Workflow",
    nameAr: "مسار إدارة الطلبات",
    en: "Sanadi is checking your requests and their progress…",
    ar: "سندي يراجع طلباتك وحالتها…",
  },
  alerts: {
    kind: "skill",
    nameEn: "Notifications Skill",
    nameAr: "مهارة الإشعارات",
    en: "Sanadi is checking your notifications…",
    ar: "سندي يراجع تنبيهاتك…",
  },
  complaint: {
    kind: "workflow",
    nameEn: "Complaint Workflow",
    nameAr: "مسار الشكاوى",
    en: "Sanadi is preparing your complaint…",
    ar: "سندي يجهّز شكواك…",
  },
  suggestion: {
    kind: "workflow",
    nameEn: "Suggestion Workflow",
    nameAr: "مسار الاقتراحات",
    en: "Sanadi is recording your suggestion…",
    ar: "سندي يسجّل اقتراحك…",
  },
  alert_report: {
    kind: "workflow",
    nameEn: "Incident Report Workflow",
    nameAr: "مسار البلاغات",
    en: "Sanadi is finding the right unit to contact…",
    ar: "سندي يحدد الجهة المختصة للتواصل…",
  },
  emergency: {
    kind: "service",
    nameEn: "Emergency & Safety Service",
    nameAr: "خدمة الطوارئ والسلامة",
    en: "Sanadi is retrieving the official emergency contacts…",
    ar: "سندي يجلب جهات الطوارئ الرسمية…",
  },
  action_plan: {
    kind: "service",
    nameEn: "Student Action Plan Service",
    nameAr: "خدمة خطة العمل الطلابية",
    en: "Sanadi is building your priorities…",
    ar: "سندي يعدّ أولوياتك…",
  },
  resolve: {
    kind: "workflow",
    nameEn: "Issue Resolution Workflow",
    nameAr: "مسار حل المشكلات",
    en: "Sanadi is working through your issue…",
    ar: "سندي يعالج مسألتك…",
  },
  knowledge: {
    kind: "retrieval",
    nameEn: "Knowledge Retrieval Service",
    nameAr: "خدمة استرجاع المعرفة",
    en: "Sanadi is checking the official university sources…",
    ar: "سندي يراجع المصادر الرسمية للجامعة…",
  },
  routing: {
    kind: "workflow",
    nameEn: "Case Routing Workflow",
    nameAr: "مسار توجيه الطلبات",
    en: "Sanadi is routing your request to the appropriate team…",
    ar: "سندي يوجّه طلبك إلى الجهة المختصة…",
  },
};

export function stageLabel(stage: AgentStage, lang: Lang): string {
  const entry = STAGE_LABELS[stage];
  return lang === "ar" ? entry.ar : entry.en;
}

/** The component name for a stage (never called an agent), in the conversation language. */
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
};

/**
 * The "What Sanadi did" list, built only from tools that really executed.
 * Duplicated wording is collapsed and the list is capped so it stays readable.
 */
export function buildActivitySteps(toolNames: string[], lang: Lang): string[] {
  const steps: string[] = [];
  for (const name of toolNames) {
    const entry = TOOL_STEPS[name];
    if (!entry) continue;
    const label = lang === "ar" ? entry.ar : entry.en;
    if (!steps.includes(label)) steps.push(label);
  }
  return steps.slice(0, 8);
}

/** Which kind of component handles a stage. */
export function stageKind(stage: AgentStage): ComponentKind {
  return STAGE_LABELS[stage].kind;
}
