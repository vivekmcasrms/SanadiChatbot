/**
 * Governed learning layer — shared, client-safe vocabulary.
 *
 * Sanadi observes corrections, detects repeated patterns, proposes a change,
 * waits for a human decision, then activates and monitors it. Nothing in this
 * layer ever rewrites policy, eligibility, permissions or service logic.
 */

export const CORRECTION_TYPES = [
  "INTENT_CORRECTION",
  "DOMAIN_CORRECTION",
  "ROUTING_CORRECTION",
  "UNIT_REASSIGNMENT",
  "STAFF_REASSIGNMENT",
  "KNOWLEDGE_GAP",
  "RESPONSE_QUALITY",
  "WORKFLOW_FAILURE",
  "FALSE_RESOLUTION",
  "CASE_REOPEN",
  "STUDENT_CLARIFICATION",
  "OTHER",
] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const CORRECTION_SOURCES = ["STAFF", "STUDENT", "SYSTEM", "ADMIN"] as const;
export type CorrectionSource = (typeof CORRECTION_SOURCES)[number];

export const CANDIDATE_TYPES = [
  "ROUTING_RULE",
  "INTENT_ALIAS",
  "UNIT_ALIAS",
  "KNOWLEDGE_GAP",
  "CLARIFICATION_RULE",
  "TOOL_SELECTION_RULE",
  "PROMPT_IMPROVEMENT",
  "WORKFLOW_IMPROVEMENT",
] as const;
export type CandidateType = (typeof CANDIDATE_TYPES)[number];

export const CANDIDATE_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "DEFERRED", "ACTIVE"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * What Sanadi is allowed to learn on its own (after human approval).
 * Anything not on this list stays a human decision, permanently.
 */
export const SAFE_LEARNING_AREAS: CandidateType[] = [...CANDIDATE_TYPES];

/**
 * Subjects that can never be learned, no matter how many signals agree:
 * programme rules, graduation requirements, eligibility, permissions,
 * financial rules, staff access, SLA targets, official policy, security
 * rules and approval requirements.
 */
export const FORBIDDEN_LEARNING_RE =
  /(eligib|graduation requirement|degree requirement|programme rule|program rule|study plan rule|gpa (rule|threshold|minimum)|credit (rule|limit|requirement)|permission|access right|role assignment|privilege|fee|fees|tuition|payment|refund|invoice|financial|sla|service level|deadline policy|official policy|regulation|bylaw|security|approval requirement|who (can|may) approve|شروط الأهلية|أهلية|متطلبات التخرج|لائحة|سياسة رسمية|صلاحي|رسوم|مالي|أمن|اعتماد|موافقة رسمية|مستوى الخدمة)/i;

/** Student feedback reasons offered after an unhelpful answer. */
export const FEEDBACK_REASONS = [
  { code: "WRONG_ANSWER", en: "Wrong answer", ar: "إجابة خاطئة", correction: "RESPONSE_QUALITY" },
  { code: "WRONG_SERVICE", en: "Wrong service or unit", ar: "خدمة أو جهة غير صحيحة", correction: "ROUTING_CORRECTION" },
  { code: "NOT_UNDERSTOOD", en: "Did not understand me", ar: "لم يفهم طلبي", correction: "INTENT_CORRECTION" },
  { code: "INCOMPLETE", en: "Incomplete information", ar: "معلومات ناقصة", correction: "KNOWLEDGE_GAP" },
  { code: "ACTION_FAILED", en: "The action did not work", ar: "الإجراء لم ينجح", correction: "WORKFLOW_FAILURE" },
  { code: "NEED_HUMAN", en: "Still need a human", ar: "ما زلت بحاجة إلى موظف", correction: "WORKFLOW_FAILURE" },
  { code: "OTHER", en: "Something else", ar: "سبب آخر", correction: "OTHER" },
] as const;
export type FeedbackReasonCode = (typeof FEEDBACK_REASONS)[number]["code"];

/** Quick reasons a staff member can pick when correcting a case (one tap). */
export const STAFF_REASON_CODES = [
  { code: "NOT_OUR_SERVICE", en: "Not our service", ar: "ليست خدمتنا" },
  { code: "WRONG_CATEGORY", en: "Wrong category", ar: "تصنيف غير صحيح" },
  { code: "NEEDS_SPECIALIST", en: "Needs a specialist", ar: "يحتاج إلى مختص" },
  { code: "WORKLOAD", en: "Workload balancing", ar: "توزيع أعباء العمل" },
  { code: "STUDENT_CLARIFIED", en: "Student clarified the request", ar: "الطالب أوضح طلبه" },
  { code: "OTHER", en: "Other", ar: "أخرى" },
] as const;

export const DEFAULT_PATTERN_THRESHOLD = 3;

export const CANDIDATE_LABELS: Record<CandidateType, { en: string; ar: string }> = {
  ROUTING_RULE: { en: "Routing rule", ar: "قاعدة توجيه" },
  INTENT_ALIAS: { en: "Intent wording", ar: "صياغة نية" },
  UNIT_ALIAS: { en: "Service name alias", ar: "اسم بديل لخدمة" },
  KNOWLEDGE_GAP: { en: "Knowledge gap", ar: "فجوة معرفية" },
  CLARIFICATION_RULE: { en: "Clarification rule", ar: "قاعدة استيضاح" },
  TOOL_SELECTION_RULE: { en: "Tool selection hint", ar: "إرشاد اختيار أداة" },
  PROMPT_IMPROVEMENT: { en: "Response phrasing", ar: "صياغة الرد" },
  WORKFLOW_IMPROVEMENT: { en: "Workflow improvement", ar: "تحسين مسار العمل" },
};
