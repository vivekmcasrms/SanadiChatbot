import { emiratiGloss } from "@/lib/arabic/emirati";
/**
 * Dynamic context assembly. Server only.
 *
 * Phase-2 performance work: instead of sending one universal 20k-token prompt
 * (all 38 tool schemas, every service playbook, the whole conversation), each
 * turn detects the service domains it actually touches and assembles only:
 *   - the playbooks for those domains
 *   - the tool schemas for those domains
 *   - a compact, service-specific verified context object
 *   - the recent, relevant conversation turns
 * Business rules are untouched: the context objects are produced by running the
 * existing read tools, so the same code decides eligibility as before.
 */
import { classifyBookSense } from "./book-intent.server";
import { isHostelIntent } from "@/lib/hostel/rules";
import { isTransferIntent } from "@/lib/transfer/rules";
import type { LlmMessage, LlmToolDef } from "./provider.server";
import {
  authorizeTool,
  TOOL_REGISTRY,
  toolByName,
  type Db,
  type ToolContext,
  type ToolGovernance,
  type ToolResult,
} from "./tools.server";

export type ServiceDomain =
  | "document"
  | "career"
  | "academic"
  | "cases"
  | "alerts"
  | "appointments"
  | "availability"
  | "library"
  | "housing";

const DOMAIN_PATTERNS: Record<ServiceDomain, RegExp> = {
  housing: /\b(hostel|dorm|accommodation|student housing|single room|double room)\b|السكن الجامعي|طلب السكن|حجز السكن|غرفة فردية|غرفة مزدوجة/i,
  document:
    /(letter|certificate|proof of (study|enrol)|enrol(l)?ment letter|to whom it may concern|embassy|sponsor letter|bank letter|شهادة|إفادة|خطاب|إلى من يهمه الأمر)/i,
  // Deliberately broad: students ask about work in everyday words ("what can
  // I do after I graduate"), not in service vocabulary.
  career:
    /(cv|resume|career|job|jobs|role(s)? (for|match)|ats|applicant tracking|skill(s)? gap|missing skills|what skills|employab|interview|counsell?or|counselor|career (adviser|advisor|coach)|after graduation|job market|ready to apply|what can i (do|work|apply)|which (jobs|roles|careers)|internship fit|سيرة ذاتية|سيرتي|مهني|مهنية|وظيف|الوظائف|مهارات|مقابلة|مقابلات|مرشد مهني|سوق العمل|بعد التخرج)/i,
  academic:
    /(gpa|credit|grade|graduat|register|registration|hold|course|prerequisite|standing|transcript|معدل|ساعات|درجة|تخرج|تسجيل|قيد|مقرر|متطلب)/i,
  // Includes natural-language follow-up on an existing request: adding
  // information, amending details, questioning, correcting or objecting.
  cases:
    /(case|complaint|request|ticket|reference number|status of my|add (something|more|information)|change (the )?(details|what i)|modify my|update my (request|complaint)|this (information|result) is (incorrect|wrong)|i disagree|don'?t agree|object(ion)?|appeal|reconsider|review (the|my) (decision|result)|correct(ion)? (my|the|request)|not (happy|satisfied) with (the|this) (result|outcome|decision)|حالتي|طلبي|شكوى|شكواي|رقم مرجعي|أعترض|اعتراض|لا أوافق|غير موافق|إعادة النظر|تصحيح|تعديل طلبي|أضيف|إضافة معلومة|غير صحيح|غير راض)/i,
  alerts: /(alert|notification|deadline|reminder|تنبيه|إشعار|تذكير|موعد نهائي)/i,
  // Deliberately excludes a bare "book": that word is resolved by sense in
  // `classifyBookSense`, so "find me a book" never reaches the appointment agent.
  appointments:
    /(appointment|slot|meeting|advisor|adviser|consultation|book(ing)?\s+(me|us|an?|the)\s*(appointment|slot|meeting|session|consultation|time)?|موعد|مواعيد|حجز موعد|مقابلة|مرشد)/i,
  availability: /(open|closed|available|when can i apply|period|window|متاح|مغلق|مفتوح|فترة)/i,
  library:
    /(librar|book|e-?book|textbook|journal|article|catalogue|catalog|borrow|renew|loan|due date|shelf|call number|study (space|room|area)|databases?|e-?resource|electronic resource|online access|find (me )?(a |some )?(book|books|articles?|journals?)|do you have (this|the|a copy of|any)|do (you|the library) have\b|isbn|citation|cite|apa|ieee|harvard|research support|interlibrary|opening hours|open (today|on|now)|where is the (library|main library)|where can i (find|get|borrow) |مكتبة|المكتبة|كتاب|كتب|كتاب إلكتروني|دورية|مقال|مقالات|إعارة|استعارة|تجديد|رف|فهرس|اقتباس|توثيق|قاعدة بيانات|قواعد البيانات|قاعة دراسة|ساعات العمل|أوقات الدوام|رقم التصنيف)/i,
};

/** Read tools that need no arguments and can be prefetched in parallel. */
const DOMAIN_PREFETCH: Record<ServiceDomain, string[]> = {
  housing: [],
  document: ["check_enrollment_letter_readiness"],
  career: ["get_career_cv_status"],
  academic: ["get_student_academic_status"],
  cases: ["get_my_cases"],
  alerts: ["get_my_alerts"],
  appointments: [],
  availability: [],
  library: [],
};

const DOMAIN_TOOLS: Record<ServiceDomain, string[]> = {
  housing: ["get_hostel_eligibility", "book_hostel_room"],
  document: ["check_enrollment_letter_readiness", "issue_enrollment_letter"],
  career: [
    "get_career_cv_status",
    "analyze_career_fit",
    "get_ats_score",
    "generate_career_action_plan",
    "review_my_cv",
    "get_interview_preparation",
    "request_career_counsellor",
  ],
  academic: [
    "assess_programme_transfer",
    "request_inter_college_transfer",
    "get_student_academic_status",
    "get_academic_progress",
    "get_my_courses",
    "get_student_holds",
    "get_hold_details",
    "open_hold_resolution_case",
    "get_hold_resolution_status",

    "check_registration_eligibility",
    "check_registration_readiness",
    "get_student_status",
    "get_registration_window",
    "get_active_holds",
    "get_prerequisite_status",
    "get_course_eligibility",
    "get_graduation_progress",
    "get_course_prerequisites",
  ],


  cases: [
    "get_my_cases",
    "find_my_university_records",
    "get_case_result",
    "add_case_information",
    "modify_case_request",
    "raise_case_review",
  ],
  alerts: ["get_my_alerts", "mark_alert_read"],
  appointments: [
    "list_appointment_slots",
    "get_my_appointments",
    "book_appointment",
    "cancel_appointment",
    "reschedule_appointment",
  ],
  availability: ["check_service_availability", "set_service_reminder"],
  library: [
    "search_library_catalogue",
    "get_library_hours",
    "get_library_service_info",
    "build_library_citation",
    "ask_a_librarian",
  ],
};

/**
 * Always available, regardless of domain: knowledge, service lookup and the
 * three universal service actions. Without these the assistant would lose
 * capability, which this optimisation must never do.
 */
const CORE_TOOLS = [
  "search_knowledge_base",
  "find_university_service",
  "create_complaint",
  "create_suggestion",
  "escalate_to_human",
];

/** Upper bound on tool schemas described to the model in one turn. */
const MAX_TOOL_DEFS = 11;

/** Detects which service domains a turn touches. At most three are kept. */
export function detectDomains(message: string): ServiceDomain[] {
  if (isTransferIntent(message)) return ["academic"];
  if (isHostelIntent(message)) return ["housing"];
  const found: ServiceDomain[] = [];
  for (const [domain, re] of Object.entries(DOMAIN_PATTERNS) as [ServiceDomain, RegExp][]) {
    if (re.test(message) || re.test(emiratiGloss(message))) found.push(domain);
  }
  // Strong domain sense wins over generic keyword overlap: a library request
  // must never expose appointment tools, and vice versa.
  const sense = classifyBookSense(message);
  let ordered = found;
  if (sense === "library") {
    ordered = found.filter((d) => d !== "appointments" && d !== "library");
    ordered = ["library", ...ordered];
  } else if (sense === "appointment") {
    ordered = found.filter((d) => d !== "library" && d !== "appointments");
    ordered = ["appointments", ...ordered];
  } else if (found.includes("library")) {
    ordered = ["library", ...found.filter((d) => d !== "library")];
  }
  return ordered.slice(0, 3);
}

/**
 * Short, referential wording that only makes sense against the previous turn:
 * "what should I learn first", "why is it low", "explain these gaps".
 */
const FOLLOW_UP_RE =
  /^(?:\s*(?:and|so|ok(?:ay)?|but|also)\b[\s,]*)?(?:why|how|what|which|when|who|is|are|does|do|can you|could you|tell me|explain|expand|more|elaborate|give me|show me|any|and)\b|(?:\bthese\b|\bthose\b|\bthis\b|\bit\b|\bthem\b|\bthat one\b)|\b(?:the )?(?:first|second|third|last)\s+(?:one|book|result|option|item)\b|^(?:لماذا|كيف|ما|ماذا|أي|هل|وضح|اشرح|المزيد|هذه|هذا|تلك)/i;

/** True when the message reads as a continuation rather than a new topic. */
export function isFollowUp(message: string): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return words <= 14 && FOLLOW_UP_RE.test(message.trim());
}

/**
 * Routing priority: the explicit intent in this message first, then the domain
 * the conversation is already in. A short follow-up ("what skills am I
 * missing?") stays anchored to the active domain unless it clearly names a
 * different service.
 */
export function detectDomainsWithContext(
  message: string,
  activeDomain?: ServiceDomain | null,
): { domains: ServiceDomain[]; anchored: boolean } {
  const explicit = detectDomains(message);
  if (!activeDomain) return { domains: explicit, anchored: false };
  if (explicit.includes(activeDomain)) return { domains: explicit, anchored: true };
  // A clear topic change wins: the student named another service outright.
  if (explicit.length && !isFollowUp(message)) return { domains: explicit, anchored: false };
  return { domains: [activeDomain, ...explicit].slice(0, 3), anchored: true };
}

/** The domain to carry into the next turn, when this turn had a clear one. */
export function nextActiveDomain(
  domains: ServiceDomain[],
  previous?: ServiceDomain | null,
): ServiceDomain | null {
  return domains[0] ?? previous ?? null;
}

export function isServiceDomain(value: unknown): value is ServiceDomain {
  return typeof value === "string" && value in DOMAIN_PATTERNS;
}

/** Tool schemas for this turn only: core tools plus the detected domains'. */
export function selectToolDefs(
  domains: ServiceDomain[],
  roles: string[],
  governance: Map<string, ToolGovernance>,
  workflowTools?: string[],
): LlmToolDef[] {
  const wanted = new Set<string>(workflowTools?.length ? workflowTools : CORE_TOOLS);
  if (!workflowTools?.length) {
    for (const d of domains) for (const name of DOMAIN_TOOLS[d] ?? []) wanted.add(name);
  }
  // With no detected domain the student is asking something general: keep the
  // personal-record tools so "what is my status" still works.
  if (!domains.length && !workflowTools?.length) for (const name of DOMAIN_TOOLS.academic) wanted.add(name);

  const allowed = TOOL_REGISTRY.filter(
    (t) => wanted.has(t.name) && authorizeTool(t, governance.get(t.name), roles).allowed,
  );
  // Prompt budget: tool schemas were the single largest static cost (~1.3k
  // tokens on academic turns). The routed domain's own tools are described
  // first, the universal ones after, and the list is capped — a turn that
  // needs a twelfth capability is a turn that should have been routed better.
  const domainTools = new Set(domains.flatMap((d) => DOMAIN_TOOLS[d] ?? []));
  const ordered = [
    ...allowed.filter((t) => domainTools.has(t.name)),
    ...allowed.filter((t) => !domainTools.has(t.name)),
  ];
  return ordered.slice(0, MAX_TOOL_DEFS).map((t) => ({
    name: t.name,
    description: (t.readOnly
      ? t.description
      : `${t.description} This tool does NOT execute immediately: it returns awaiting_student_confirmation and the student must confirm.`
    ).slice(0, 240),
    parameters: t.parameters,
  }));
}

export type ServiceContext = {
  domain: ServiceDomain;
  toolName: string;
  data: unknown;
};

/**
 * Compact, service-specific context objects produced by running the existing
 * argument-free read tool for that service in parallel. Only the fields that
 * tool already returns are included — no universal student blob.
 */
export async function buildServiceContexts(
  ctx: ToolContext,
  domains: ServiceDomain[],
  timeoutMs: number,
  workflowPrefetch?: string[],
): Promise<{ contexts: ServiceContext[]; results: { toolName: string; ok: boolean; data: unknown }[]; parallel: number }> {
  const names = (workflowPrefetch?.length ? workflowPrefetch : domains.flatMap((d) => DOMAIN_PREFETCH[d] ?? [])).slice(0, 3);
  if (!names.length) return { contexts: [], results: [], parallel: 0 };

  const settled = await Promise.all(
    names.map(async (name) => {
      const tool = toolByName(name);
      if (!tool || !tool.readOnly) return null;
      const result = await Promise.race<ToolResult>([
        tool.run(ctx, {}),
        new Promise<ToolResult>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: "context_timeout" }), timeoutMs),
        ),
      ]).catch((): ToolResult => ({ ok: false, error: "context_error" }));
      return { name, result };
    }),
  );

  const contexts: ServiceContext[] = [];
  const results: { toolName: string; ok: boolean; data: unknown }[] = [];
  for (const entry of settled) {
    if (!entry?.result.ok) continue;
    const domain = domains.length === 1 ? domains[0] : (Object.keys(DOMAIN_PREFETCH) as ServiceDomain[]).find((d) =>
      (DOMAIN_PREFETCH[d] ?? []).includes(entry.name),
    );
    if (!domain) continue;
    contexts.push({ domain, toolName: entry.name, data: entry.result.data });
    results.push({ toolName: entry.name, ok: true, data: entry.result.data });
  }
  return { contexts, results, parallel: names.length > 1 ? names.length : 0 };
}

/** Renders the prefetched contexts as one compact, bounded prompt block. */
export function renderContextBlock(contexts: ServiceContext[]): string {
  if (!contexts.length) return "";
  const stamp = new Date().toISOString();
  const body = contexts
    .map((c) => `${c.toolName}: ${JSON.stringify(compactToolData(c.toolName, c.data)).slice(0, 1400)}`)
    .join("\n");
  return `\n\nVERIFIED CONTEXT (retrieved for this turn at ${stamp} — use these values directly and do not call the same read tool again in this turn):\n${body}\nFRESHNESS: these are a snapshot. Availability figures (appointment slots), holds and service windows can change. Before proposing or executing an action, call the live availability tool for that service again; the server also re-checks every value immediately before the write and will refuse a stale action.`;
}

/** Retains decision evidence while dropping verbose records from model input. */
export function compactToolData(toolName: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  const keep: Record<string, string[]> = {
    list_appointment_slots: ["slots", "appointmentTypes", "note"],
    analyze_career_fit: ["hasCv", "profileSource", "profileUsed", "programme", "gpa", "completedCredits", "matches", "skillGaps", "discrepancies", "note"],
  };
  const keys = keep[toolName];
  if (!keys) return value;
  return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
}

/* ------------------------------------------------------------------ */
/* Conversation compression                                            */
/* ------------------------------------------------------------------ */

/**
 * Recent relevant turns only. Older turns are represented by the structured
 * conversation summary, which already preserves decisions, confirmations and
 * unresolved actions.
 */
export function compressHistory(
  rows: { role: string; content: string }[],
  currentMessage: string,
): LlmMessage[] {
  const words = currentMessage
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3);
  const recent = rows.slice(-4);
  return recent
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m, index) => {
      const relevant =
        index >= recent.length - 2 || words.some((w) => m.content.toLowerCase().includes(w));
      const limit = relevant ? 700 : 220;
      return { role: m.role as "user" | "assistant", content: m.content.slice(0, limit) };
    });
}

/** Coarse token estimate used only for telemetry and budgeting. */
export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function estimateRequestTokens(messages: LlmMessage[], tools: LlmToolDef[]): number {
  const messageChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const toolChars = tools.reduce((sum, t) => sum + JSON.stringify(t).length, 0);
  return estimateTokens(`${messageChars ? "x".repeat(messageChars) : ""}`) + estimateTokens("x".repeat(toolChars));
}

export type PrefetchDb = Db;
