/**
 * "Resolve This for Me" Agent (issue coordinator). Server only.
 *
 * Responsibility: the student describes a problem once ("I can't register",
 * "I don't know what I need to graduate", "I have a problem and don't know who
 * to contact"). This agent decides which specialised agents are needed, runs
 * only those, merges their verified findings into ONE coordinated student
 * issue, reports what is already handled, and proposes a single real case for
 * the part that still needs a human.
 *
 * Orchestration is deterministic: coordinator -> specialised agents/tools ->
 * merged result. There is no agent-to-agent model conversation, and the model
 * never decides readiness, blockers or ownership — it may only explain them.
 *
 * Reused agents (never duplicated here):
 *  · Registration Readiness  — evaluateRegistrationReadiness
 *  · Hold Resolution         — loadHoldDossiers
 *  · Academic Progress       — loadStudentSnapshot + computeDegreeProgress
 *  · Career                  — findOpenCounsellingRequest
 *
 * Duplicate-case safety: a hold that already has an open resolution case is
 * reported as tracked, never re-raised, and at most one new case is proposed
 * per turn.
 */
import type { Citation, Lang } from "../agent-types";
import { loadStudentSnapshot, type StudentSnapshot } from "../student-context.server";
import { loadAcademicCourses } from "../academic-record.server";
import { findOpenCounsellingRequest } from "../career/counselling.server";
import { computeDegreeProgress, type DegreeProgress } from "./academic-progress.server";
import { loadHoldDossiers, type HoldDossier } from "./hold-resolution.server";
import { evaluateRegistrationReadiness, type ReadinessCheck } from "./registration-readiness.server";
import type { Db } from "./tools.server";

export type IssueTopic = "registration" | "graduation" | "career" | "contact" | "general";

export type InvokedAgent =
  | "registration_readiness"
  | "hold_resolution"
  | "academic_progress"
  | "career";

/** Structured, persisted state of the coordinated student issue. */
export type ResolveIssueState = {
  issueId: string;
  topic: IssueTopic;
  openedAt: string;
  updatedAt: string;
  problemStatement: string;
  invokedAgents: InvokedAgent[];
  checksRun: string[];
  actionsTaken: string[];
  unresolvedBlockers: {
    key: string;
    labelEn: string;
    labelAr: string;
    owner: string | null;
    detailEn?: string;
    detailAr?: string;
  }[];

  caseIds: { caseId: string; reference: string; status: string; assignedStaff: string | null }[];
  outcome: "resolved" | "partially_resolved" | "routed" | "needs_action" | "no_issue_found";
};

export type ResolveIssueReport = {
  topic: IssueTopic;
  answer: string;
  nextSteps: string[];
  citations: Citation[];
  verified: boolean;
  proposals: { toolName: string; args: Record<string, unknown> }[];
  state: ResolveIssueState;
};

/* ------------------------------------------------------------------ */
/* Intent detection                                                     */
/* ------------------------------------------------------------------ */

/** Problem-shaped phrasing: the student is stuck, not asking a factual question. */
const PROBLEM_RE =
  /\b(can'?t|cannot|can not|unable to|not able to|won'?t let me|blocked from|having (a )?(problem|issue|trouble)|have a problem|i'?m stuck|im stuck|stuck|something (is )?wrong|doesn'?t work|does not work|need help( with| on| for)?|help me (with|to|resolve|fix|sort)|sort (this|it) out|fix (this|it)|resolve (this|it|my)|deal with (this|it)|take care of (this|it)|don'?t know (what|who|where|how))\b|(لا أستطيع|لا استطيع|ما أقدر|ما اقدر|ما بقدر|مو قادر|عندي مشكلة|في مشكلة|مشكلة في|ما ينفع|ما يشتغل|لا يعمل|ساعدني|أحتاج مساعدة|احتاج مساعدة|حل لي|حل هذي|حل هذه|تصرف لي|ما أعرف|ما اعرف|لا أعرف|لا اعرف|مين أراجع|من أراجع|وش أسوي|ماذا أفعل)/i;

const TOPIC_RE: { topic: IssueTopic; re: RegExp }[] = [
  {
    topic: "registration",
    re: /\b(register|registration|registering|enrol|enroll|enrolment|enrollment|add (a )?course|sign up for (a )?course)\b|(التسجيل|أسجل|اسجل|تسجيلي|التسجيل بالمواد|إضافة مادة)/i,
  },
  {
    topic: "graduation",
    re: /\b(graduate|graduation|graduating|degree audit|finish my degree|complete my degree|final year)\b|(تخرج|التخرج|إنهاء الدرجة)/i,
  },
  {
    topic: "career",
    re: /\b(career|job|internship|cv|resume|employability|counsell?or)\b|(المهنة|المهني|الوظيفة|وظيفة|تدريب|السيرة الذاتية|مرشد مهني)/i,
  },
  {
    topic: "contact",
    re: /\b(who to (contact|talk to|speak to|ask)|who (do i|should i|can i) (contact|talk to|speak to|ask)|which (unit|office|department)|where do i go|who is responsible)\b|(مين أراجع|من أراجع|أي (جهة|قسم|مكتب)|الجهة المسؤولة|وين أروح|أين أذهب)/i,
  },
];

/**
 * True when the message is a problem the coordinator should own, and returns
 * the topic that decides which agents run. Purely lexical — no model call.
 */
export function detectResolveIssueIntent(message: string): IssueTopic | null {
  const text = message.trim();
  if (!text) return null;
  const explicit =
    /\b(resolve this for me|sort this out for me|handle (this|it) for me|take care of (this|it) for me)\b|(حل لي المشكلة|تكفل بالموضوع)/i.test(
      text,
    );
  if (!explicit && !PROBLEM_RE.test(text)) return null;
  for (const t of TOPIC_RE) if (t.re.test(text)) return t.topic;
  return explicit || /(don'?t know|ما أعرف|ما اعرف|لا أعرف|لا اعرف|مين أراجع|من أراجع)/i.test(text)
    ? "general"
    : "general";
}

/* ------------------------------------------------------------------ */
/* Coordination plan                                                    */
/* ------------------------------------------------------------------ */

/** Only the agents the topic actually needs — never a full fan-out. */
export function planAgents(topic: IssueTopic): InvokedAgent[] {
  switch (topic) {
    case "registration":
      return ["hold_resolution", "registration_readiness", "academic_progress"];
    case "graduation":
      return ["academic_progress", "hold_resolution"];
    case "career":
      return ["career", "academic_progress"];
    case "contact":
    case "general":
    default:
      return ["hold_resolution", "registration_readiness"];
  }
}

function citation(lang: Lang, titleEn: string, titleAr: string, unitEn: string, unitAr: string): Citation {
  return {
    documentId: null,
    sourceTitle: lang === "ar" ? titleAr : titleEn,
    owningUnit: lang === "ar" ? unitAr : unitEn,
    documentVersion: null,
    effectiveDate: null,
    citationUrl: null,
    confidence: "high",
  };
}

async function staffNameFor(_db: Db, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  // Students cannot read a staff profile row directly, so the responsible
  // person's name is resolved with the service client.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}


const issueId = () =>
  `ISS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

/* ------------------------------------------------------------------ */
/* The coordinator                                                      */
/* ------------------------------------------------------------------ */

export async function runResolveIssueAgent(
  db: Db,
  userId: string,
  lang: Lang,
  message: string,
  topic: IssueTopic,
  prior?: ResolveIssueState | null,
): Promise<ResolveIssueReport | null> {
  const ar = lang === "ar";
  const L = (en: string, arr: string) => (ar ? arr : en);

  const snapshot: StudentSnapshot = await loadStudentSnapshot(db, userId);
  if (!snapshot.hasProfile) return null;

  const agents = planAgents(topic);
  const checksRun: string[] = [];
  const actionsTaken: string[] = [];
  const unresolved: ResolveIssueState["unresolvedBlockers"] = [];
  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];
  const citations: Citation[] = [];
  const sections: string[] = [];
  const nextSteps: string[] = [];

  /* --- Hold Resolution Agent ------------------------------------- */
  let activeHolds: HoldDossier[] = [];
  if (agents.includes("hold_resolution")) {
    const dossiers = await loadHoldDossiers(db, userId).catch(() => null);
    if (dossiers) {
      checksRun.push(L("active holds", "القيود النشطة"));
      citations.push(
        citation(lang, "Student holds register", "سجل القيود الطلابية", "Admission & Registration", "القبول والتسجيل"),
      );
      activeHolds = dossiers.active;
      if (!activeHolds.length) {
        sections.push(L("No active hold is on your record.", "لا يوجد أي قيد نشط على سجلك."));
      } else {
        for (const h of activeHolds) {
          const owner = ar ? h.unitNameAr : h.unitNameEn;
          const tracked = h.existingCase?.open ? h.existingCase : null;
          sections.push(
            [
              `**${ar ? h.titleAr : h.titleEn}** (${ar ? h.typeAr : h.typeEn})`,
              `${L("Responsible unit", "الجهة المسؤولة")}: ${owner ?? L("not confirmed", "غير مؤكدة")}${
                h.unitUnknown ? L(" (inferred, not confirmed on the hold)", " (مستنتجة، غير مؤكدة على القيد)") : ""
              }`,
              (ar ? h.actionAr : h.actionEn)
                ? `${L("Required", "المطلوب")}: ${ar ? h.actionAr : h.actionEn}`
                : null,
              tracked
                ? `${L("Tracked case", "طلب قيد المتابعة")}: ${tracked.reference} — ${tracked.status}`
                : null,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          unresolved.push({
            key: `hold:${h.holdId}`,
            labelEn: h.titleEn,
            labelAr: h.titleAr,
            owner: h.unitNameEn ?? null,
          });
          if (tracked) {
            actionsTaken.push(
              L(
                `hold "${h.titleEn}" already routed to ${h.unitNameEn ?? "the responsible unit"} as case ${tracked.reference}`,
                `القيد «${h.titleAr}» تمت إحالته مسبقاً إلى ${h.unitNameAr ?? "الجهة المسؤولة"} بالطلب ${tracked.reference}`,
              ),
            );
          }
        }
      }
    }
  }

  /* --- Registration Readiness Agent ------------------------------ */
  let readinessBlockers: ReadinessCheck[] = [];
  let registrationReady: boolean | null = null;
  if (agents.includes("registration_readiness")) {
    const result = await evaluateRegistrationReadiness(db, userId).catch(() => null);
    if (result) {
      checksRun.push(L("registration readiness rules", "قواعد جاهزية التسجيل"));
      citations.push(
        citation(lang, "Registration rules and academic calendar", "قواعد التسجيل والتقويم الأكاديمي", "Admission & Registration", "القبول والتسجيل"),
      );
      registrationReady = result.readiness.ready;
      // Holds are already reported above — do not repeat them as blockers.
      readinessBlockers = result.readiness.blockers.filter((b) => b.key !== "holds");
      for (const b of readinessBlockers) {
        unresolved.push({
          key: `registration:${b.key}`,
          labelEn: b.labelEn,
          labelAr: b.labelAr,
          owner: "Admission & Registration",
          detailEn: b.detailEn,
          detailAr: b.detailAr,
        });
        sections.push(`**${ar ? b.labelAr : b.labelEn}** — ${ar ? b.detailAr : b.detailEn}`);
      }

      if (registrationReady) {
        sections.push(
          L(
            "Every registration rule I can verify passes, so nothing on the registration side is blocking you.",
            "جميع قواعد التسجيل التي يمكنني التحقق منها مستوفاة، ولا شيء من جهة التسجيل يمنعك.",
          ),
        );
      } else if (!readinessBlockers.length && !activeHolds.length) {
        sections.push(
          L(
            "I could not confirm every registration rule from your record; nothing verified is blocking you.",
            "لم أستطع التحقق من جميع قواعد التسجيل من سجلك؛ ولا يوجد مانع مؤكد.",
          ),
        );
      }
    }
  }

  /* --- Academic Progress Agent ----------------------------------- */
  let progress: DegreeProgress | null = null;
  if (agents.includes("academic_progress")) {
    const courses = await loadAcademicCourses(db, userId, snapshot.programId).catch(() => null);
    if (courses) {
      checksRun.push(L("degree progress", "التقدم الأكاديمي"));
      citations.push(
        citation(lang, "Student academic record", "السجل الأكاديمي للطالب", "Student Academic Services", "خدمات الطلبة الأكاديمية"),
      );
      progress = computeDegreeProgress(snapshot, courses);
      sections.push(
        L(
          `Degree progress: ${progress.completedCredits} credits completed, ${progress.remainingCredits} remaining (${progress.percentComplete}%).`,
          `التقدم في الدرجة: ${progress.completedCredits} ساعة مكتملة، و${progress.remainingCredits} ساعة متبقية (${progress.percentComplete}%).`,
        ),
      );
      if (topic === "graduation" && progress.remainingCredits > 0) {
        unresolved.push({
          key: "academic:remaining_credits",
          labelEn: `${progress.remainingCredits} credit hours remaining`,
          labelAr: `${progress.remainingCredits} ساعة معتمدة متبقية`,
          owner: "Student Academic Services",
        });
      }
    }
  }

  /* --- Career Agent ---------------------------------------------- */
  if (agents.includes("career")) {
    const open = await findOpenCounsellingRequest(db, userId).catch(() => null);
    checksRun.push(L("career counselling requests", "طلبات الإرشاد المهني"));
    if (open) {
      actionsTaken.push(
        L("a career counselling request is already open and being followed up", "يوجد طلب إرشاد مهني مفتوح قيد المتابعة"),
      );
      sections.push(
        L(
          "You already have an open career counselling request, so I did not raise a duplicate.",
          "لديك بالفعل طلب إرشاد مهني مفتوح، لذلك لم أنشئ طلباً مكرراً.",
        ),
      );
    } else {
      unresolved.push({
        key: "career:counselling",
        labelEn: "career guidance not yet arranged",
        labelAr: "لم يتم ترتيب إرشاد مهني بعد",
        owner: "Career Services",
      });
      proposals.push({ toolName: "request_career_counsellor", args: {} });
      sections.push(
        L(
          "No career counselling request is open on your record — I can raise one with Career Services now.",
          "لا يوجد طلب إرشاد مهني مفتوح على سجلك — يمكنني رفع طلب لدى خدمات الإرشاد المهني الآن.",
        ),
      );
    }
  }

  /* --- One coordinated case, never duplicates --------------------- */
  const caseIds: ResolveIssueState["caseIds"] = [];
  const linked = activeHolds.map((h) => h.existingCase).filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (linked.length) {
    const { data: rows } = await db
      .from("cases")
      .select("id, case_number, status, assigned_to")
      .in("id", linked.map((c) => c.caseId));
    for (const row of rows ?? []) {
      caseIds.push({
        caseId: row.id,
        reference: row.case_number,
        status: row.status,
        assignedStaff: await staffNameFor(db, row.assigned_to),
      });
    }
  }

  const untracked = activeHolds.filter((h) => !h.existingCase?.open);
  const alreadyOpenCase = caseIds.some((c) => !["resolved", "closed"].includes(c.status));
  if (untracked.length && !proposals.length) {
    // Exactly one case per turn: the hold that blocks the most.
    const primary =
      untracked.find((h) => h.blocksRegistration) ?? untracked.find((h) => h.blocksGraduation) ?? untracked[0]!;
    proposals.push({ toolName: "open_hold_resolution_case", args: { holdId: primary.holdId } });
    sections.push(
      L(
        `I can open one tracked case with ${primary.unitNameEn ?? "the responsible unit"} covering this issue, with your verified record attached — you will not be asked for anything again.`,
        `يمكنني فتح طلب واحد متابَع لدى ${primary.unitNameAr ?? "الجهة المسؤولة"} يغطي هذه المشكلة مع إرفاق بيانات سجلك الموثقة — لن يُطلب منك إدخال أي معلومة مرة أخرى.`,
      ),
    );
  }

  /* --- Outcome ---------------------------------------------------- */
  const outcome: ResolveIssueState["outcome"] = !unresolved.length
    ? "no_issue_found"
    : alreadyOpenCase && unresolved.length === caseIds.length
      ? "routed"
      : caseIds.length || actionsTaken.length
        ? "partially_resolved"
        : "needs_action";

  const head =
    outcome === "no_issue_found"
      ? L(
          "I checked the systems that could be behind this and found nothing blocking you.",
          "راجعت الأنظمة التي قد تكون سبب المشكلة ولم أجد ما يمنعك.",
        )
      : L(
          `I understood the problem, checked ${checksRun.length} verified ${checksRun.length === 1 ? "system" : "systems"}, and here is exactly where it stands:`,
          `فهمت المشكلة، وراجعت ${checksRun.length} ${checksRun.length === 1 ? "مصدراً" : "مصادر"} موثقة، وهذا هو الوضع بالضبط:`,
        );

  const tail: string[] = [];
  if (actionsTaken.length)
    tail.push(
      L(
        `Already handled: ${actionsTaken.join("; ")}.`,
        `ما تم التعامل معه بالفعل: ${actionsTaken.join("؛ ")}.`,
      ),
    );
  if (caseIds.length)
    tail.push(
      L(
        `I am tracking ${caseIds.length === 1 ? "this case" : "these cases"}: ${caseIds
          .map((c) => `${c.reference} (${c.status}${c.assignedStaff ? `, ${c.assignedStaff}` : ""})`)
          .join(", ")}, and I will tell you when the status changes.`,
        `أتابع ${caseIds.length === 1 ? "الطلب" : "الطلبات"}: ${caseIds
          .map((c) => `${c.reference} (${c.status}${c.assignedStaff ? `، ${c.assignedStaff}` : ""})`)
          .join("، ")}، وسأخبرك عند تغير الحالة.`,
      ),
    );
  if (!unresolved.length && registrationReady === null && !progress)
    tail.push(
      L(
        "If the problem is something else, describe what you were trying to do and I will route it to the right unit.",
        "إذا كانت المشكلة شيئاً آخر، صف ما كنت تحاول فعله وسأحيلها إلى الجهة الصحيحة.",
      ),
    );

  if (unresolved.length)
    nextSteps.push(
      ...unresolved.slice(0, 4).map((b) => {
        // A bare category ("Timetable") is not an instruction: carry the
        // verified detail so the student knows what to actually do.
        const label = ar ? b.labelAr : b.labelEn;
        const detail = (ar ? b.detailAr : b.detailEn)?.trim();
        const body = detail ? `${label} — ${detail}` : label;
        return ar ? `متابعة: ${body}` : `Follow up: ${body}`;
      }),
    );


  const answer = [head, sections.join("\n\n"), tail.join(" ")].filter(Boolean).join("\n\n");

  const state: ResolveIssueState = {
    issueId: prior?.issueId ?? issueId(),
    topic,
    openedAt: prior?.openedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    problemStatement: prior?.problemStatement ?? message.slice(0, 300),
    invokedAgents: agents,
    checksRun,
    actionsTaken,
    unresolvedBlockers: unresolved,
    caseIds,
    outcome,
  };

  return { topic, answer, nextSteps, citations, verified: true, proposals, state };
}
