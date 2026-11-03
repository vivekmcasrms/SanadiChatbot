/**
 * Tool registry. Server only.
 * Every tool declares its schema, risk level, authorisation rules and audit
 * behaviour. Tools receive the caller's RLS-scoped Supabase client and the
 * session-derived user id — never an identity supplied by the model.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ActionRisk, Citation, Lang } from "../agent-types";
import { loadStudentSnapshot, DEFAULT_TOTAL_CREDIT_HOURS } from "../student-context.server";
import {
  runAcademicProgressAgent,
  type AcademicProgressIntent,
} from "./academic-progress.server";
import {
  buildRegistrationReadinessReport,
  evaluateRegistrationReadiness,
  getPrerequisiteStatus,
  getRegistrationWindow,
  CREDIT_RULES,
} from "./registration-readiness.server";
import {
  buildHoldCaseDescription,
  buildHoldResolutionReport,
  loadHoldDossiers,
} from "./hold-resolution.server";



import { caseFollowupTools } from "./case-followup-tools.server";


export type Db = SupabaseClient<Database>;

export type ToolContext = {
  db: Db;
  userId: string;
  lang: Lang;
  roles: string[];
  conversationId: string | null;
  /** Correlates retrieval, tool and performance logs for one assistant turn. */
  traceId?: string | null;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  citations?: Citation[];
  /** Human-readable reference produced by a write tool. */
  reference?: {
    referenceNumber: string | null;
    actionType: string;
    unitId: string | null;
    unitName: string | null;
    caseId?: string | null;
    suggestionId?: string | null;
    appointmentId?: string | null;
    expectedFirstResponseHours?: number | null;
    expectedResolutionDays?: number | null;
    trackingUrl?: string | null;
    nextStepEn?: string;
    nextStepAr?: string;
  };
};

export type ToolDefinition = {
  name: string;
  agentType: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ActionRisk;
  readOnly: boolean;
  confirmationRequired: boolean;
  humanApprovalRequired: boolean;
  allowedRoles: string[];
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

/**
 * A slot that filled up or was withdrawn while the student was confirming it.
 * The student is told in plain language and offered the remaining times; the
 * technical reason is recorded internally against the turn's trace reference.
 */
async function bookingConflict(ctx: ToolContext, slotId: string, reason: string): Promise<ToolResult> {
  const { logException } = await import("@/lib/exceptions/handle.server");
  const { exceptionMessage, exceptionFallback } = await import("@/lib/exceptions/catalogue");
  await logException("booking_conflict", {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    traceId: ctx.traceId ?? null,
    detail: reason,
    recovered: true,
    recoveryAction: "offer_remaining_times",
    context: { slotId },
  });
  return {
    ok: false,
    error: exceptionMessage("booking_conflict", ctx.lang === "ar" ? "ar" : "en"),
    data: {
      nextStep: exceptionFallback("booking_conflict", ctx.lang === "ar" ? "ar" : "en"),
      reReadAvailability: true,
    },
  };
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const enumStr = (description: string, values: string[]) => ({
  type: "string",
  description,
  enum: values,
});

const nowPlusHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function recordCitation(
  titleEn: string,
  titleAr: string,
  unit: string | null,
  lang: Lang,
): Citation {
  return {
    documentId: null,
    sourceTitle: lang === "ar" ? titleAr : titleEn,
    owningUnit: unit,
    documentVersion: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    citationUrl: null,
    confidence: "high",
  };
}

async function unitByCode(db: Db, code: string | null) {
  if (!code) return null;
  const { data } = await db
    .from("service_units")
    .select(
      "id, code, name_en, name_ar, contact_email, phone_extension, office_location_en, office_location_ar, service_hours_en, service_hours_ar",
    )
    .eq("code", code)
    .maybeSingle();
  return data;
}

/* ------------------------------------------------------------------ */
/* Read tools                                                          */
/* ------------------------------------------------------------------ */

const readTools: ToolDefinition[] = [
  {
    name: "get_student_academic_status",
    agentType: "query",
    description:
      "Returns the signed-in student's verified academic record: programme, level, GPA, academic standing, completed and registered credit hours, expected graduation date, open cases and unread alerts.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!s.hasProfile)
        return { ok: false, error: "No academic record is linked to this account." };
      return {
        ok: true,
        data: {
          programme: ctx.lang === "ar" ? s.programNameAr : s.programNameEn,
          level: s.level,
          gpa: s.gpa,
          standing: s.standing,
          completedCredits: s.completedCredits,
          registeredCredits: s.registeredCredits,
          programmeTotalCredits: s.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS,
          remainingCredits: s.remainingCredits,
          expectedGraduation: s.expectedGraduation,
          openCases: s.openCases,
          unreadAlerts: s.unreadAlerts,
        },
        citations: [
          recordCitation(
            "Your student record in the university system",
            "سجلك الطلابي في النظام",
            ctx.lang === "ar" ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_my_identity",
    agentType: "query",
    description:
      "Returns the signed-in student's verified identity: full name, student ID, college, programme, academic level, enrollment status and current semester. Use this whenever the student asks who they are or about their own profile details — never guess from chat history.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!s.hasProfile)
        return { ok: false, error: "No student record is linked to this account." };
      return {
        ok: true,
        data: {
          fullName: s.fullName,
          studentId: s.studentNumber,
          college: ctx.lang === "ar" ? s.collegeNameAr : s.collegeNameEn,
          programme: ctx.lang === "ar" ? s.programNameAr : s.programNameEn,
          academicLevel: s.level,
          enrollmentStatus: s.enrollmentStatus,
          currentSemester: ctx.lang === "ar" ? s.currentTermAr : s.currentTermEn,
          gpa: s.gpa,
          completedCredits: s.completedCredits,
          registeredCredits: s.registeredCredits,
          expectedGraduation: s.expectedGraduation,
          academicStanding: s.standing,
          profileLink: "/academic#profile",
        },
        citations: [
          recordCitation(
            "Your student record in the university system",
            "سجلك الطلابي في النظام",
            ctx.lang === "ar" ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_my_courses",
    agentType: "query",
    description:
      "Returns the signed-in student's completed courses, current registered courses, remaining REQUIRED study-plan courses and outstanding elective requirements (credit hours / number of choices from an approved list — never every course in the list). Computed deterministically; never invent course lists.",
    parameters: obj({
      scope: {
        type: "string",
        enum: ["completed", "current", "remaining", "all"],
        description: "Which course list to return.",
      },
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!s.hasProfile)
        return { ok: false, error: "No student record is linked to this account." };
      const { loadAcademicCourses } = await import("../academic-record.server");
      const c = await loadAcademicCourses(ctx.db, ctx.userId, s.programId);
      const scope = String((args as Record<string, unknown>)["scope"] ?? "all");
      const brief = (list: typeof c.completed) =>
        list.map((x) => ({
          code: x.code,
          title: ctx.lang === "ar" ? x.titleAr : x.titleEn,
          creditHours: x.creditHours,
          grade: x.grade,
          term: ctx.lang === "ar" ? x.termAr : x.termEn,
        }));
      return {
        ok: true,
        data: {
          ...(scope === "all" || scope === "completed"
            ? { completed: brief(c.completed), completedCreditHours: c.completedCreditHours }
            : {}),
          ...(scope === "all" || scope === "current"
            ? { current: brief(c.current), currentCreditHours: c.currentCreditHours }
            : {}),
          ...(scope === "all" || scope === "remaining"
            ? {
                remainingRequiredCourses: brief(c.remaining),
                requiredRemainingCreditHours: c.fixedRemainingCreditHours,
                electiveRequirements: c.baskets
                  .filter((b) => !b.satisfied)
                  .map((b) => ({
                    name: ctx.lang === "ar" ? b.nameAr : b.nameEn,
                    remainingCreditHours: b.remainingCreditHours,
                    remainingCourseCount: b.remainingCourseCount,
                    chooseFromApprovedList: true,
                    approvedListVerified: b.courseListVerified,
                  })),
                remainingCreditHours: c.remainingCreditHours,
                studyPlanRegistered: c.programCourseCount > 0,
              }
            : {}),

          links: {
            completed: "/academic#completed",
            current: "/academic#current",
            remaining: "/academic#remaining",
          },
        },
        citations: [
          recordCitation(
            "Your student record in the university system",
            "سجلك الطلابي في النظام",
            ctx.lang === "ar" ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_student_holds",
    agentType: "query",
    description:
      "Lists the active holds on the signed-in student's record, whether each hold blocks registration or graduation, and the action required to clear it.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      return {
        ok: true,
        data: {
          holdCount: s.holds.length,
          holds: s.holds.map((h) => ({
            title: ctx.lang === "ar" ? h.titleAr : h.titleEn,
            description: ctx.lang === "ar" ? h.descriptionAr : h.descriptionEn,
            resolution: ctx.lang === "ar" ? h.resolutionAr : h.resolutionEn,
            blocksRegistration: h.blocksRegistration,
            blocksGraduation: h.blocksGraduation,
          })),
        },
        citations: [
          recordCitation(
            "Student holds register",
            "سجل القيود الطلابية",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "check_registration_eligibility",
    agentType: "query",
    description:
      "Checks whether the signed-in student can register for the next term: returns blocking holds, outstanding requirements and current registered credit hours.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      const blocking = s.holds.filter((h) => h.blocksRegistration);
      return {
        ok: true,
        data: {
          canRegister: blocking.length === 0,
          blockingHolds: blocking.map((h) => ({
            title: ctx.lang === "ar" ? h.titleAr : h.titleEn,
            resolution: ctx.lang === "ar" ? h.resolutionAr : h.resolutionEn,
          })),
          outstandingRequirements: s.requirements.map((r) => ({
            title: ctx.lang === "ar" ? r.titleAr : r.titleEn,
            status: r.status,
            dueDate: r.dueDate,
          })),
          registeredCredits: s.registeredCredits,
        },
        citations: [
          recordCitation(
            "Registration eligibility check",
            "فحص أهلية التسجيل",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  /* ---- Registration Readiness Agent ---- */
  {
    name: "check_registration_readiness",
    agentType: "registration_readiness",
    description:
      "Registration Readiness Agent. Runs every backend registration rule for the signed-in student — service availability, registration window, enrolment status, holds, academic standing, outstanding requirements, prerequisites, course eligibility, timetable clashes and credit-load limits — and returns a deterministic Ready to Register / Action Required verdict with each blocker. Use for 'am I ready to register', 'can I register', 'what is blocking my registration'. Never decide readiness yourself; report what this tool returns. This tool does not register any course.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const report = await buildRegistrationReadinessReport(ctx.db, ctx.userId, ctx.lang);
      if (!report)
        return {
          ok: false,
          error:
            ctx.lang === "ar"
              ? "لا يوجد سجل طالب مرتبط بهذا الحساب."
              : "No student record is linked to this account.",
        };
      return {
        ok: true,
        data: {
          verdict: report.ready ? "ready_to_register" : "action_required",
          summary: report.answer,
          blockers: report.readiness.blockers.map((b) => ({
            area: ctx.lang === "ar" ? b.labelAr : b.labelEn,
            detail: ctx.lang === "ar" ? b.detailAr : b.detailEn,
            fix: ctx.lang === "ar" ? b.fixAr : b.fixEn,
          })),
          warnings: report.readiness.warnings.map((w) => (ctx.lang === "ar" ? w.detailAr : w.detailEn)),
          unverified: report.readiness.unknowns.map((u) => (ctx.lang === "ar" ? u.detailAr : u.detailEn)),
          window: report.readiness.window,
          eligibleCourses: report.readiness.eligibleCourses,
          ineligibleCourses: report.readiness.ineligibleCourses,
        },
        citations: report.citations,
      };
    },
  },
  {
    name: "get_student_status",
    agentType: "registration_readiness",
    description:
      "Returns the signed-in student's registration-relevant status: enrolment status, academic standing, level, GPA, registered credit hours and the credit-load limits that apply to them.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!s.hasProfile)
        return { ok: false, error: "No student record is linked to this account." };
      const probation = /probation|warning|إنذار|مراقبة/i.test(s.standing ?? "");
      return {
        ok: true,
        data: {
          enrollmentStatus: s.enrollmentStatus,
          academicStanding: s.standing,
          academicLevel: s.level,
          gpa: s.gpa,
          registeredCredits: s.registeredCredits,
          completedCredits: s.completedCredits,
          minCreditsPerTerm: CREDIT_RULES.minPerTerm,
          maxCreditsPerTerm: probation ? CREDIT_RULES.maxOnProbation : CREDIT_RULES.maxPerTerm,
          currentSemester: ctx.lang === "ar" ? s.currentTermAr : s.currentTermEn,
        },
        citations: [
          recordCitation(
            "Your student record in the university system",
            "سجلك الطلابي في النظام",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_registration_window",
    agentType: "registration_readiness",
    description:
      "Returns the published registration window for the current or next term from the academic calendar: term name, opening and closing dates, add/drop deadline and whether registration is open, upcoming or closed.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const window = await getRegistrationWindow(ctx.db);
      return {
        ok: true,
        data: window,
        citations: [
          recordCitation(
            "University academic calendar",
            "التقويم الأكاديمي للجامعة",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_active_holds",
    agentType: "registration_readiness",
    description:
      "Returns the signed-in student's active holds, whether each one blocks registration or graduation, and the recorded action needed to clear it.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!s.hasProfile)
        return { ok: false, error: "No student record is linked to this account." };
      return {
        ok: true,
        data: {
          holds: s.holds.map((h) => ({
            title: ctx.lang === "ar" ? h.titleAr : h.titleEn,
            description: ctx.lang === "ar" ? h.descriptionAr : h.descriptionEn,
            resolution: ctx.lang === "ar" ? h.resolutionAr : h.resolutionEn,
            blocksRegistration: h.blocksRegistration,
            blocksGraduation: h.blocksGraduation,
          })),
          blocksRegistration: s.holds.some((h) => h.blocksRegistration),
        },
        citations: [
          recordCitation(
            "Student holds record",
            "سجل الإيقافات الطلابية",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_prerequisite_status",
    agentType: "registration_readiness",
    description:
      "Checks whether the signed-in student has satisfied the prerequisites of one or more courses given their codes (for example ELEC320). Returns the missing prerequisite for each course, from verified course history.",
    parameters: obj(
      {
        courseCodes: {
          type: "array",
          description: "Course codes to check, for example [\"ELEC320\", \"CSCI305\"]",
          items: { type: "string" },
        },
      },
      ["courseCodes"],
    ),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const codes = (Array.isArray(args["courseCodes"]) ? args["courseCodes"] : [])
        .map((c) => String(c).trim().toUpperCase().replace(/\s+/g, ""))
        .filter(Boolean)
        .slice(0, 10);
      if (!codes.length) return { ok: false, error: "At least one course code is required." };
      const { data: rows } = await ctx.db.from("courses").select("id, code, title_en, title_ar").in("code", codes);
      if (!rows?.length) return { ok: false, error: `No course found with code ${codes.join(", ")}.` };
      const missingByCourse = await getPrerequisiteStatus(
        ctx.db,
        ctx.userId,
        rows.map((r) => r.id),
      );
      return {
        ok: true,
        data: {
          courses: rows.map((r) => {
            const missing = missingByCourse.get(r.id) ?? [];
            return {
              code: r.code,
              title: ctx.lang === "ar" ? r.title_ar : r.title_en,
              satisfied: missing.length === 0,
              missing: missing.map((m) => ({
                code: m.code,
                title: ctx.lang === "ar" ? m.titleAr : m.titleEn,
                minimumGrade: m.minimumGrade,
              })),
            };
          }),
          notFound: codes.filter((c) => !rows.some((r) => r.code.toUpperCase() === c)),
        },
        citations: [
          recordCitation(
            "University course catalogue",
            "الدليل الأكاديمي للمقررات",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_course_eligibility",
    agentType: "registration_readiness",
    description:
      "Returns which of the signed-in student's next study-plan courses they are eligible to register for now, and which are blocked by a missing prerequisite. Computed deterministically from the programme plan and verified course history.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const result = await evaluateRegistrationReadiness(ctx.db, ctx.userId);
      if (!result)
        return { ok: false, error: "No student record is linked to this account." };
      return {
        ok: true,
        data: {
          eligibleCourses: result.readiness.eligibleCourses,
          ineligibleCourses: result.readiness.ineligibleCourses,
          registeredCredits: result.readiness.registeredCredits,
          registrationWindow: result.readiness.window,
        },
        citations: [
          recordCitation(
            "Your study plan and course history",
            "خطتك الدراسية وسجل مقرراتك",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  /* ---- Student Hold Resolution Agent ---- */
  {
    name: "get_hold_details",
    agentType: "hold_resolution",
    description:
      "Student Hold Resolution Agent. Returns a full dossier for every hold on the signed-in student's record: hold type, reason, responsible unit and its contact, exactly what the student must do, whether it blocks registration or graduation, its status, and any resolution case already tracking it. Use whenever a student asks about a hold, a block, or why they cannot register or graduate.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const report = await buildHoldResolutionReport(ctx.db, ctx.userId, ctx.lang);
      if (!report)
        return { ok: false, error: "No student record is linked to this account." };
      const ar = ctx.lang === "ar";
      const shape = (h: (typeof report.holds)[number]) => ({
        holdId: h.holdId,
        holdType: ar ? h.typeAr : h.typeEn,
        title: ar ? h.titleAr : h.titleEn,
        reason: ar ? h.reasonAr : h.reasonEn,
        responsibleUnit: ar ? h.unitNameAr : h.unitNameEn,
        responsibleUnitConfirmed: !h.unitUnknown,
        contact: h.unitEmail,
        whatToDo: ar ? h.actionAr : h.actionEn,
        blocksRegistration: h.blocksRegistration,
        blocksGraduation: h.blocksGraduation,
        status: h.status,
        resolutionCase: h.existingCase,
      });
      return {
        ok: true,
        data: {
          activeHoldCount: report.holds.length,
          holds: report.holds.map(shape),
          clearedHolds: report.resolvedHolds.map(shape),
          summary: report.answer,
        },
        citations: report.citations,
      };
    },
  },
  {
    name: "open_hold_resolution_case",
    agentType: "hold_resolution",
    description:
      "Opens a real tracked case with the unit responsible for one of the signed-in student's holds, attaching the verified hold details and the student's identity, programme and academic record automatically — never ask the student to re-enter them. The case is routed, assigned and SLA-tracked like any other request. Requires student confirmation. Use the holdId returned by get_hold_details.",
    parameters: obj({ holdId: str("Hold id from get_hold_details") }, ["holdId"]),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const holdId = String(args["holdId"] ?? "").trim();
      if (!holdId) return { ok: false, error: "holdId is required." };
      const snapshot = await loadStudentSnapshot(ctx.db, ctx.userId);
      if (!snapshot.hasProfile)
        return { ok: false, error: "No student record is linked to this account." };
      const { active, resolved } = await loadHoldDossiers(ctx.db, ctx.userId);
      const hold = active.find((h) => h.holdId === holdId);
      if (!hold) {
        const cleared = resolved.find((h) => h.holdId === holdId);
        return {
          ok: false,
          error: cleared
            ? "That hold is no longer active on the record, so no resolution case is needed."
            : "No active hold with that id is on this student's record.",
        };
      }
      // Never open a second case for a hold that is already being worked.
      if (hold.existingCase?.open) {
        return {
          ok: true,
          data: {
            alreadyTracked: true,
            caseId: hold.existingCase.caseId,
            reference: hold.existingCase.reference,
            status: hold.existingCase.status,
            trackingUrl: hold.existingCase.trackingUrl,
          },
        };
      }

      const ar = ctx.lang === "ar";
      const title = (
        ar
          ? `رفع قيد: ${hold.titleAr}`
          : `Clear hold: ${hold.titleEn}`
      ).slice(0, 160);
      const { submitInteraction } = await import("@/lib/interactions/intake.server");
      let result;
      try {
        result = await submitInteraction({
          studentId: ctx.userId,
          lang: ctx.lang,
          title,
          description: buildHoldCaseDescription(hold, snapshot, ctx.lang),
          shortcutHint: "query",
          channel: "chat",
          urgencyHint: hold.blocksRegistration || hold.blocksGraduation ? "high" : "medium",
          sensitiveHint: hold.category === "disciplinary" || hold.category === "medical",
          unitId: hold.unitId,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Submission failed" };
      }

      return {
        ok: true,
        data: {
          caseId: result.kind === "case" ? result.id : null,
          reference: result.reference,
          holdId: hold.holdId,
          holdType: ar ? hold.typeAr : hold.typeEn,
          responsibleUnit: ar ? hold.unitNameAr : hold.unitNameEn,
          acknowledgement: ar ? result.acknowledgementAr : result.acknowledgementEn,
          attachedContext: [
            "student identity",
            "student number",
            "programme",
            "academic standing",
            "hold details",
          ],
        },
        reference: {
          referenceNumber: result.reference,
          actionType: "open_hold_resolution_case",
          unitId: hold.unitId,
          unitName: ar ? hold.unitNameAr : hold.unitNameEn,
          caseId: result.kind === "case" ? result.id : null,
          expectedFirstResponseHours: 24,
          expectedResolutionDays: 5,
          trackingUrl: result.trackingUrl,
          nextStepEn: `${hold.unitNameEn ?? "The responsible unit"} will review your hold and reply in the case thread. You can follow progress at any time.`,
          nextStepAr: `${hold.unitNameAr ?? "الجهة المسؤولة"} ستراجع القيد وترد عليك في سجل الحالة، ويمكنك متابعة التقدم في أي وقت.`,
        },
      };
    },
  },
  {
    name: "get_hold_resolution_status",
    agentType: "hold_resolution",
    description:
      "Follow-up tool: reports the current progress of the signed-in student's hold-resolution cases and whether the underlying hold is still active or has been cleared. Use when the student asks what happened to their hold request.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const ar = ctx.lang === "ar";
      const { active, resolved } = await loadHoldDossiers(ctx.db, ctx.userId);
      const all = [...active, ...resolved];
      const tracked = all.filter((h) => h.existingCase);
      return {
        ok: true,
        data: {
          trackedCount: tracked.length,
          items: tracked.map((h) => ({
            hold: ar ? h.titleAr : h.titleEn,
            holdStillActive: h.status === "active",
            responsibleUnit: ar ? h.unitNameAr : h.unitNameEn,
            caseReference: h.existingCase?.reference,
            caseStatus: h.existingCase?.status,
            caseOpen: h.existingCase?.open,
            trackingUrl: h.existingCase?.trackingUrl,
          })),
          untrackedActiveHolds: active
            .filter((h) => !h.existingCase?.open)
            .map((h) => ({ holdId: h.holdId, hold: ar ? h.titleAr : h.titleEn })),
        },
      };
    },
  },
  {


    name: "get_academic_progress",
    agentType: "academic_progress",
    description:
      "Academic Progress Agent. Returns the signed-in student's verified academic progress: completed/registered/remaining credit hours, completed, current and remaining courses computed from the programme study plan, degree percentage, on-track assessment, pending requirements and any academic data that could not be verified. Use for questions about credits, courses taken/needed, degree progress, graduation readiness or what to focus on academically.",
    parameters: obj({
      focus: enumStr("Which part of the progress the student asked about", [
        "overview",
        "credits_completed",
        "credits_remaining",
        "courses_completed",
        "courses_current",
        "courses_remaining",
        "graduation",
        "focus",
      ]),
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const focus = (args["focus"] as AcademicProgressIntent | undefined) ?? "overview";
      const report = await runAcademicProgressAgent(ctx.db, ctx.userId, ctx.lang, focus);
      if (!report) {
        return {
          ok: false,
          error:
            ctx.lang === "ar"
              ? "لا يوجد سجل طالب مرتبط بهذا الحساب، ولا يمكن حساب التقدم الأكاديمي."
              : "No student record is linked to this account, so academic progress cannot be calculated.",
        };
      }
      return {
        ok: true,
        data: {
          summary: report.answer,
          progress: report.state.progress,
          counts: {
            completedCourses: report.state.completedCourses,
            currentCourses: report.state.currentCourses,
            remainingCourses: report.state.remainingCourses,
          },
          studyPlanRegistered: report.state.studyPlanRegistered,
          unverified: report.dataGaps,
        },
        citations: report.citations,
      };
    },
  },
  {
    name: "get_graduation_progress",

    agentType: "query",
    description:
      "Returns the signed-in student's graduation progress: completed vs required credit hours, remaining requirements, holds affecting graduation and the expected graduation date.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const s = await loadStudentSnapshot(ctx.db, ctx.userId);
      const total = s.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS;
      return {
        ok: true,
        data: {
          completedCredits: s.completedCredits,
          requiredCredits: total,
          remainingCredits: Math.max(0, total - s.completedCredits),
          percentComplete: Math.round((s.completedCredits / total) * 100),
          expectedGraduation: s.expectedGraduation,
          pendingRequirements: s.requirements.map((r) => ({
            title: ctx.lang === "ar" ? r.titleAr : r.titleEn,
            status: r.status,
            dueDate: r.dueDate,
          })),
          graduationHolds: s.holds
            .filter((h) => h.blocksGraduation)
            .map((h) => (ctx.lang === "ar" ? h.titleAr : h.titleEn)),
        },
        citations: [
          recordCitation(
            "Degree audit record",
            "سجل تدقيق التخرج",
            ctx.lang === "ar" ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "get_course_prerequisites",
    agentType: "query",
    description:
      "Returns the prerequisites of a course by course code (for example CSCI305) and whether the signed-in student has already satisfied each one.",
    parameters: obj({ courseCode: str("Course code, for example CSCI305 or MATH105") }, [
      "courseCode",
    ]),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const code = String(args["courseCode"] ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      if (!code) return { ok: false, error: "A course code is required." };
      const { data: course } = await ctx.db
        .from("courses")
        .select("id, code, title_en, title_ar, credit_hours")
        .ilike("code", code)
        .maybeSingle();
      if (!course) return { ok: false, error: `No course found with code ${code}.` };

      const { data: prereqs } = await ctx.db
        .from("course_prerequisites")
        .select(
          "minimum_grade, prerequisite_type, prerequisite_course_id, courses!course_prerequisites_prerequisite_course_id_fkey (code, title_en, title_ar)",
        )
        .eq("course_id", course.id)
        .eq("is_active", true);

      const { data: history } = await ctx.db
        .from("student_course_history")
        .select("course_id, grade, completion_status")
        .eq("student_id", ctx.userId);

      const passed = new Map((history ?? []).map((h) => [h.course_id, h]));
      return {
        ok: true,
        data: {
          course: {
            code: course.code,
            title: ctx.lang === "ar" ? course.title_ar : course.title_en,
            creditHours: course.credit_hours,
          },
          prerequisites: (prereqs ?? []).map((p) => {
            const c = p.courses as { code: string; title_en: string; title_ar: string } | null;
            const taken = passed.get(p.prerequisite_course_id);
            return {
              code: c?.code ?? null,
              title: c ? (ctx.lang === "ar" ? c.title_ar : c.title_en) : null,
              minimumGrade: p.minimum_grade,
              type: p.prerequisite_type,
              satisfied: taken?.completion_status === "completed",
              yourGrade: taken?.grade ?? null,
            };
          }),
        },
        citations: [
          recordCitation(
            "University course catalogue",
            "الدليل الأكاديمي للمقررات",
            ctx.lang === "ar" ? "القبول والتسجيل" : "Admission & Registration",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "search_knowledge_base",
    agentType: "knowledge",
    description:
      "Searches the approved university knowledge corpus (policies, procedures, guides, FAQs and approved web sources) with hybrid indexed retrieval. Use this for any factual or policy question. Returns ranked passages with their document, section, version and effective date so the answer can be grounded and cited.",
    parameters: obj(
      {
        query: str("Search phrase in the student's language"),
        domain: str(
          "Optional domain scope: registration, withdrawal, documents, library, career, complaints, general",
        ),
      },
      ["query"],
    ),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const query = String(args["query"] ?? "").trim();
      if (!query) return { ok: false, error: "A search query is required." };
      const { retrieveForGrounding, KNOWLEDGE_DOMAINS } = await import("../knowledge/retrieval.server");
      const { permsFromRoles } = await import("../knowledge/permissions.server");

      const asked = String(args["domain"] ?? "").trim().toLowerCase();
      const domain = (KNOWLEDGE_DOMAINS as readonly string[]).includes(asked)
        ? (asked as (typeof KNOWLEDGE_DOMAINS)[number])
        : undefined;

      const outcome = await retrieveForGrounding(ctx.db, query, {
        lang: ctx.lang,
        perms: permsFromRoles(ctx.roles),
        limit: 5,
        ...(domain ? { domain } : {}),
        conversationId: ctx.conversationId ?? null,
        traceId: ctx.traceId ?? null,
      });

      if (!outcome.passages.length) {
        return {
          ok: true,
          data: {
            matches: 0,
            grounding: "no_evidence",
            guidance:
              "No approved source covers this question. Say clearly that the approved knowledge base does not answer it, and offer to route the student to the responsible unit instead of improvising an answer.",
          },
          citations: [],
        };
      }

      const citations: Citation[] = outcome.passages.map((p) => ({
        documentId: p.sourceType === "document" ? p.sourceId : null,
        sourceTitle: p.sectionTitle ? `${p.title} — ${p.sectionTitle}` : p.title,
        owningUnit: p.owningUnit,
        documentVersion: p.version,
        effectiveDate: p.effectiveDate,
        citationUrl: p.citationUrl,
        confidence: p.score >= 0.45 ? ("high" as const) : ("medium" as const),
      }));

      return {
        ok: true,
        data: {
          matches: outcome.passages.length,
          grounding: outcome.groundingStatus,
          domain: outcome.domain,
          passages: outcome.passages.map((p, i) => ({
            ref: `P${i + 1}`,
            sourceType: p.sourceType,
            title: p.title,
            section: p.sectionTitle,
            page: p.pageNumber,
            unit: p.owningUnit,
            version: p.version,
            effectiveDate: p.effectiveDate,
            content: p.snippet,
            score: Number(p.score.toFixed(3)),
          })),
          conflicts: outcome.conflicts.map((c) => ({
            topic: c.topic,
            severity: c.severity,
            sourceOne: c.one.title,
            statementOne: c.statementOne,
            sourceTwo: c.two.title,
            statementTwo: c.statementTwo,
          })),
          guidance: outcome.conflicts.length
            ? "Approved sources disagree. Present the most authoritative and most recent statement, say plainly that sources differ, and recommend confirming with the owning unit."
            : "Answer only from these passages. Do not add facts they do not contain.",
        },
        citations,
      };
    },
  },
  {
    name: "get_university_facts",
    agentType: "knowledge",
    description:
      "Returns verified structured facts about how UAEU is organised — the list and exact count of colleges — sourced from the official university website. Use this for any question about how many colleges/faculties exist or which colleges UAEU has, instead of searching policy documents.",
    parameters: obj({ topic: str("Fact topic: colleges") }, []),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx) {
      const { data, error } = await ctx.db
        .from("university_colleges")
        .select("name_en, name_ar, source_url, verified_at")
        .eq("is_active", true)
        .order("name_en", { ascending: true });
      if (error) return { ok: false, error: error.message };
      const colleges = (data ?? []) as { name_en: string; name_ar: string | null; source_url: string | null; verified_at: string | null }[];
      if (!colleges.length) {
        return {
          ok: true,
          data: {
            available: false,
            guidance:
              "No verified college list is indexed yet. Say the assistant cannot confirm the exact number right now and point the student to the official UAEU website.",
          },
        };
      }
      return {
        ok: true,
        data: {
          available: true,
          collegeCount: colleges.length,
          colleges: colleges.map((c) => ({ nameEn: c.name_en, nameAr: c.name_ar })),
          verifiedAt: colleges[0]?.verified_at ?? null,
          guidance: `UAEU has ${colleges.length} colleges. State this count and list them; these are verified records from the official university website.`,
        },
        citations: [
          {
            documentId: null,
            sourceTitle: "UAEU official website — Colleges",
            owningUnit: "United Arab Emirates University",
            documentVersion: null,
            effectiveDate: null,
            citationUrl: colleges[0]?.source_url ?? import.meta.env["VITE_COLLEGES_URL"],
            confidence: "high" as const,
          },
        ],
      };
    },
  },

  {
    name: "get_emergency_contact",
    agentType: "query",
    description:
      "Returns the official campus emergency contact (responsible unit, emergency number, mobile and email) for a described emergency — medical, fire, maintenance faults (electricity, water, air conditioning) or security and lost property. ALWAYS use this tool for emergency questions and never state a number from memory.",
    parameters: obj({ situation: str("Plain description of the emergency or problem") }, [
      "situation",
    ]),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const situation = String(args["situation"] ?? "");
      const { matchEmergency, loadEmergencyRecords, emergencyCitation, formatEmergencyAnswer } =
        await import("./emergency.server");
      const match = await matchEmergency(ctx.db, situation);
      if (!match) {
        const all = await loadEmergencyRecords(ctx.db);
        return {
          ok: true,
          data: {
            matched: false,
            available: all.map((r) => ({
              category: ctx.lang === "ar" ? r.categoryAr : r.categoryEn,
              type: ctx.lang === "ar" ? r.typeAr : r.typeEn,
              unit: ctx.lang === "ar" ? r.unitAr : r.unitEn,
              emergencyNumber: r.emergencyNumber,
              mobile: r.mobile,
              email: r.email,
            })),
            guidance:
              "No emergency record matches this situation. Say clearly that no specific emergency contact is registered for it, never invent a number, and offer the listed contacts or a case with the responsible unit.",
          },
        };
      }
      const r = match.record;
      return {
        ok: true,
        data: {
          matched: true,
          category: ctx.lang === "ar" ? r.categoryAr : r.categoryEn,
          type: ctx.lang === "ar" ? r.typeAr : r.typeEn,
          responsibleUnit: ctx.lang === "ar" ? r.unitAr : r.unitEn,
          emergencyNumber: r.emergencyNumber,
          mobile: r.mobile,
          email: r.email,
          notes: ctx.lang === "ar" ? r.notesAr : r.notesEn,
          readyAnswer: formatEmergencyAnswer(r, ctx.lang),
          guidance:
            "Reply with these exact details, short and prominent. Do not add or change any number, email or unit name.",
        },
        citations: [emergencyCitation(r, ctx.lang)],
      };
    },
  },



  {
    name: "find_university_service",
    agentType: "query",
    description:
      "Finds the responsible university service and unit for a described need, with contact details, processing time and whether the assistant may submit it online. Use this when the student does not know which department handles their issue.",
    parameters: obj({ need: str("Plain description of what the student needs") }, ["need"]),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const need = String(args["need"] ?? "").toLowerCase();
      const keywords = need.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
      const { data: services } = await ctx.db
        .from("university_services")
        .select(
          "id, code, name_en, name_ar, description_en, description_ar, category, estimated_processing_days, service_level_hours, allows_agent_submission, requires_human_approval, risk_level, instructions_en, instructions_ar, service_unit_id, service_units:service_unit_id (id, code, name_en, name_ar, contact_email, phone_extension, office_location_en, office_location_ar, service_hours_en, service_hours_ar)",
        )
        .eq("is_active", true);

      const ranked = (services ?? [])
        .map((s) => {
          const hay =
            `${s.name_en} ${s.name_ar} ${s.description_en ?? ""} ${s.description_ar ?? ""} ${s.category ?? ""}`.toLowerCase();
          return { s, score: keywords.filter((k) => hay.includes(k)).length };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (!ranked.length) return { ok: true, data: { matches: 0, services: [] } };

      return {
        ok: true,
        data: {
          matches: ranked.length,
          services: ranked.map(({ s }) => {
            const u = s.service_units as {
              id: string;
              code: string;
              name_en: string;
              name_ar: string;
              contact_email: string | null;
              phone_extension: string | null;
              office_location_en: string | null;
              office_location_ar: string | null;
              service_hours_en: string | null;
              service_hours_ar: string | null;
            } | null;
            return {
              serviceId: s.id,
              serviceCode: s.code,
              serviceName: ctx.lang === "ar" ? s.name_ar : s.name_en,
              description: ctx.lang === "ar" ? s.description_ar : s.description_en,
              instructions: ctx.lang === "ar" ? s.instructions_ar : s.instructions_en,
              processingDays: s.estimated_processing_days,
              serviceLevelHours: s.service_level_hours,
              canSubmitThroughAssistant: s.allows_agent_submission,
              requiresHumanApproval: s.requires_human_approval,
              riskLevel: s.risk_level,
              unitCode: u?.code ?? null,
              unitName: u ? (ctx.lang === "ar" ? u.name_ar : u.name_en) : null,
              contactEmail: u?.contact_email ?? null,
              phoneExtension: u?.phone_extension ?? null,
              office: u ? (ctx.lang === "ar" ? u.office_location_ar : u.office_location_en) : null,
              serviceHours: u
                ? ctx.lang === "ar"
                  ? u.service_hours_ar
                  : u.service_hours_en
                : null,
              // Guidance for the assistant: it must open the case itself.
              submissionGuidance: s.requires_human_approval
                ? `Open the case yourself with create_complaint (caseType "service_request", unitCode "${u?.code ?? ""}"). ${u ? (ctx.lang === "ar" ? u.name_ar : u.name_en) : "The responsible unit"} decides it; do not tell the student to contact the unit.`
                : `Open the case yourself with create_complaint (caseType "service_request", unitCode "${u?.code ?? ""}"). Do not tell the student to contact the unit.`,
            };
          }),
        },
        citations: [
          recordCitation("University service catalogue", "دليل الخدمات الجامعية", null, ctx.lang),
        ],
      };
    },
  },
  {
    name: "get_my_cases",
    agentType: "case_management",
    description:
      "Lists the signed-in student's complaints, service requests and suggestions with their reference number, status, responsible unit, due date and any meeting the responsible staff member confirmed on the case (date, mode, location or link). Use this for questions about a meeting time. If meeting is null, state that no meeting time has been confirmed yet for that request — never invent a date or time. Optionally filter by reference number.",
    parameters: obj({ referenceNumber: str("Optional case or suggestion reference number") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const ref = String(args["referenceNumber"] ?? "").trim();
      let q = ctx.db
        .from("cases")
        .select(
          "id, case_number, title, status, urgency, case_type, due_at, created_at, first_response_at, resolved_at, meeting_at, meeting_mode, meeting_location, meeting_note, service_units:service_unit_id (name_en, name_ar)",
        )
        .eq("student_id", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (ref) q = q.eq("case_number", ref);
      const { data: cases } = await q;

      const { data: suggestions } = await ctx.db
        .from("suggestions")
        .select("id, reference_number, title, status, created_at, vote_count")
        .eq("student_id", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(10);

      return {
        ok: true,
        data: {
          cases: (cases ?? []).map((c) => {
            const u = c.service_units as { name_en: string; name_ar: string } | null;
            return {
              id: c.id,
              reference: c.case_number,
              title: c.title,
              type: c.case_type,
              status: c.status,
              urgency: c.urgency,
              unit: u ? (ctx.lang === "ar" ? u.name_ar : u.name_en) : null,
              dueAt: c.due_at,
              // Meeting details only exist when a staff member set them on the
              // case. Never present a meeting time that is not recorded here.
              meeting: c.meeting_at
                ? {
                    at: c.meeting_at,
                    mode: c.meeting_mode,
                    location: c.meeting_location,
                    note: c.meeting_note,
                  }
                : null,
              meetingConfirmed: Boolean(c.meeting_at),
              firstResponseAt: c.first_response_at,
              resolvedAt: c.resolved_at,
              createdAt: c.created_at,
            };
          }),
          suggestions: (suggestions ?? []).map((s) => ({
            id: s.id,
            reference: s.reference_number,
            title: s.title,
            status: s.status,
            votes: s.vote_count,
            createdAt: s.created_at,
          })),
        },
        citations: [recordCitation("Your case records", "سجل حالاتك", null, ctx.lang)],
      };
    },
  },
  {
    name: "get_my_updates",
    agentType: "case_management",
    description:
      "Returns the signed-in student's most recent recorded updates on their requests (acknowledged, assigned, status changed, information requested, meeting confirmed or cancelled, resolved, closed, document ready). Use this for 'any update on my requests?', 'has anything changed?' or 'was my appointment confirmed?'. Only report what is returned here — never recall an update from memory.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const limit = 8;
      const { data } = await ctx.db
        .from("notification_events")
        .select("id, event_type, title, body, created_at, read_at, case_id, action_url")
        .eq("recipient_profile_id", ctx.userId)
        .eq("channel", "in_app")
        .order("created_at", { ascending: false })
        .limit(limit);
      const caseIds = Array.from(new Set((data ?? []).map((n) => n.case_id).filter(Boolean) as string[]));
      const refById = new Map<string, string>();
      if (caseIds.length) {
        const { data: cases } = await ctx.db.from("cases").select("id, case_number").in("id", caseIds);
        for (const c of cases ?? []) refById.set(c.id, c.case_number);
      }
      return {
        ok: true,
        data: {
          updates: (data ?? []).map((n) => ({
            event: n.event_type,
            message: n.body ?? n.title,
            reference: n.case_id ? (refById.get(n.case_id) ?? null) : null,
            at: n.created_at,
            unread: !n.read_at,
            link: n.action_url,
          })),
        },
        citations: [recordCitation("Your case updates", "تحديثات حالاتك", null, ctx.lang)],
      };
    },
  },
  {
    name: "get_my_alerts",
    agentType: "alert",
    description:
      "Lists the signed-in student's active personalised alerts with severity, deadline and the action required.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx) {
      const { data } = await ctx.db
        .from("student_alerts")
        .select(
          "id, title_en, title_ar, body_en, body_ar, severity, deadline, is_read, action_url, action_label_en, action_label_ar",
        )
        .eq("student_id", ctx.userId)
        .eq("status", "active")
        .order("deadline", { ascending: true })
        .limit(10);
      return {
        ok: true,
        data: {
          alerts: (data ?? []).map((a) => ({
            id: a.id,
            title: ctx.lang === "ar" ? a.title_ar : a.title_en,
            body: ctx.lang === "ar" ? a.body_ar : a.body_en,
            severity: a.severity,
            deadline: a.deadline,
            read: a.is_read,
            actionUrl: a.action_url,
            actionLabel: ctx.lang === "ar" ? a.action_label_ar : a.action_label_en,
          })),
        },
        citations: [recordCitation("Your alert centre", "مركز التنبيهات الخاص بك", null, ctx.lang)],
      };
    },
  },
  {
    name: "find_my_university_records",
    agentType: "query",
    description:
      "Checks which official documents and records the university already holds for the signed-in student (certificates, transcripts, medical notes, letters, verified case evidence). ALWAYS call this before asking a student to upload anything: if the university already has the document, use it and do not ask again.",
    parameters: obj({
      documentType: str(
        "Optional keyword to narrow the search, e.g. medical, transcript, certificate, letter",
      ),
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const keyword = String(args["documentType"] ?? "")
        .trim()
        .toLowerCase();
      const [docsRes, evidenceRes] = await Promise.all([
        ctx.db
          .from("student_documents")
          .select(
            "id, document_type, document_name, verification_status, issued_date, expiry_date, uploaded_at",
          )
          .eq("student_id", ctx.userId)
          .order("uploaded_at", { ascending: false })
          .limit(25),
        ctx.db
          .from("case_evidence")
          .select("id, file_name, created_at, case_id")
          .order("created_at", { ascending: false })
          .limit(15),
      ]);
      const match = (s: string) => !keyword || s.toLowerCase().includes(keyword);
      const documents = (docsRes.data ?? [])
        .filter((d) => match(`${d.document_type} ${d.document_name}`))
        .map((d) => ({
          name: d.document_name,
          type: d.document_type,
          status: d.verification_status,
          issued: d.issued_date,
          expires: d.expiry_date,
          heldByUniversity: true,
        }));
      const evidence = (evidenceRes.data ?? [])
        .filter((e) => match(e.file_name))
        .map((e) => ({ name: e.file_name, attachedToCase: e.case_id, uploadedAt: e.created_at }));
      return {
        ok: true,
        data: {
          documents,
          caseEvidence: evidence,
          found: documents.length + evidence.length,
          guidance:
            documents.length + evidence.length > 0
              ? "The university already holds these. Reuse them instead of asking the student to upload again."
              : "Nothing on file for this keyword — the student will need to provide it.",
        },
        citations: [
          recordCitation(
            "Your university document record",
            "سجل وثائقك لدى الجامعة",
            null,
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "list_appointment_slots",
    agentType: "action",
    description:
      "Lists real open appointment slots (staff, duration, place or online link, seats left), optionally for a service unit code, appointment type keyword or a stated time preference such as 'tomorrow afternoon'.",
    parameters: obj({
      unitCode: str("Optional service unit code, e.g. CAREER, ADV, ACCESS"),
      typeQuery: str("Optional appointment type keyword"),
      when: str("Optional natural-language time preference, e.g. 'tomorrow afternoon'"),
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { loadAvailability, filterByPreference, detectAppointmentIntent } = await import(
        "./appointment.server"
      );
      const when = String(args["when"] ?? "");
      const intent = when ? detectAppointmentIntent(`appointment ${when}`) : null;
      const slots = await loadAvailability(ctx.db, {
        unitCode: String(args["unitCode"] ?? "").toUpperCase() || null,
        typeQuery: String(args["typeQuery"] ?? "") || null,
        from: intent?.from ?? null,
        to: intent?.to ?? null,
        limit: 40,
      });
      const preferred = intent ? filterByPreference(slots, intent) : slots;
      const shown = (preferred.length ? preferred : slots).slice(0, 8);
      return {
        ok: true,
        data: {
          slots: shown.map((s) => ({
            slotId: s.slotId,
            start: s.start,
            end: s.end,
            seatsLeft: s.seatsLeft,
            type: ctx.lang === "ar" ? s.typeNameAr : s.typeNameEn,
            durationMinutes: s.durationMinutes,
            locationType: s.locationType,
            location: s.location,
            meetingLink: s.meetingLink,
            staffName: s.staffName,
            staffEmail: s.staffEmail,
            unit: ctx.lang === "ar" ? s.unitNameAr : s.unitNameEn,
            unitCode: s.unitCode,
            requiresApproval: s.requiresApproval,
          })),
          note:
            shown.length === 0
              ? "No published availability matches. Never invent a time — offer to open a request with the unit."
              : "These are real open slots. Booking must go through book_appointment.",
        },
      };
    },
  },
  {
    name: "get_my_appointments",
    agentType: "action",
    description:
      "Returns the signed-in student's own appointments with staff, unit, date, time, place or online link, status and confirmation code.",
    parameters: obj({
      includePast: { type: "boolean", description: "Include past appointments" },
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { loadMyAppointments } = await import("./appointment.server");
      const list = await loadMyAppointments(ctx.db, Boolean(args["includePast"]));
      return { ok: true, data: { appointments: list, count: list.length } };
    },
  },

];

/* ------------------------------------------------------------------ */
/* Write tools — never executed without an explicit student confirmation */
/* ------------------------------------------------------------------ */

const writeTools: ToolDefinition[] = [
  {
    name: "create_complaint",
    agentType: "complaint",
    description:
      "Files a formal complaint or service request on behalf of the signed-in student and routes it to the responsible unit. Requires student confirmation.",
    parameters: obj(
      {
        title: str("Short title of the complaint"),
        description: str("Full description in the student's own words"),
        unitCode: str("Service unit code that should own the case"),
        urgency: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Urgency",
        },
        caseType: {
          type: "string",
          enum: ["complaint", "query", "alert", "suggestion"],
          description:
            "Interaction type you believe this is. Sanadi re-classifies it, so this is only a hint.",
        },
        isSensitive: {
          type: "boolean",
          description: "True for harassment, discrimination or safety topics",
        },
      },
      ["title", "description"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const title = String(args["title"] ?? "").slice(0, 160);
      const description = String(args["description"] ?? "").slice(0, 8000);
      if (!title || !description)
        return { ok: false, error: "Title and description are required." };
      const urgency = (
        ["low", "medium", "high", "critical"].includes(String(args["urgency"]))
          ? String(args["urgency"])
          : null
      ) as "low" | "medium" | "high" | "critical" | null;
      const hinted = String(args["caseType"] ?? "complaint");
      const shortcutHint = (
        ["complaint", "query", "alert", "suggestion"].includes(hinted) ? hinted : "complaint"
      ) as "complaint" | "query" | "alert" | "suggestion";

      // Chat and shortcuts share one backend pipeline: classify → route → SLA →
      // create → orchestrate, so the same wording always produces the same case.
      const { submitInteraction } = await import("@/lib/interactions/intake.server");
      let result;
      try {
        result = await submitInteraction({
          studentId: ctx.userId,
          lang: ctx.lang,
          title,
          description,
          shortcutHint,
          channel: "chat",
          urgencyHint: urgency,
          sensitiveHint: Boolean(args["isSensitive"]),
          unitId: (await unitByCode(ctx.db, (args["unitCode"] as string) ?? null))?.id ?? null,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Submission failed" };
      }

      // A complaint is a symptom. Where Sanadi can operate the service itself,
      // it attempts the real fix now and records the attempt on the case.
      let resolution = null;
      if (result.kind === "case" && result.interactionType === "complaint") {
        const { attemptComplaintResolution } = await import("@/lib/ops/complaint-resolution.server");
        resolution = await attemptComplaintResolution({
          db: ctx.db,
          userId: ctx.userId,
          lang: ctx.lang,
          caseId: result.id,
          title,
          description,
        });
      }

      return {
        ok: true,
        data: {
          caseId: result.kind === "case" ? result.id : null,
          suggestionId: result.kind === "suggestion" ? result.id : null,
          reference: result.reference,
          interactionType: result.interactionType,
          acknowledgement: ctx.lang === "ar" ? result.acknowledgementAr : result.acknowledgementEn,
          emergencyContacts: result.emergencyContacts,
          linkedSuggestionId: result.linkedSuggestionId,
          automaticResolutionAttempt: resolution
            ? {
                topic: resolution.topic,
                summary: ctx.lang === "ar" ? resolution.summaryAr : resolution.summaryEn,
                nextTool: resolution.proposal?.toolName ?? null,
              }
            : null,
        },
        reference: {
          referenceNumber: result.reference,
          actionType: `create_${result.interactionType}`,
          unitId: null,
          unitName: ctx.lang === "ar" ? result.classification.serviceLabel.ar : result.classification.serviceLabel.en,
          caseId: result.kind === "case" ? result.id : null,
          suggestionId: result.kind === "suggestion" ? result.id : null,
          expectedFirstResponseHours: result.interactionType === "alert" ? 2 : 24,
          expectedResolutionDays: result.interactionType === "alert" ? 1 : 10,
          trackingUrl: result.trackingUrl,
          nextStepEn: result.acknowledgementEn,
          nextStepAr: result.acknowledgementAr,
        },
      };
    },
  },
  {
    name: "create_suggestion",
    agentType: "suggestion",
    description:
      "Submits an improvement suggestion on behalf of the signed-in student and routes it to the relevant unit for review. Requires student confirmation.",
    parameters: obj(
      {
        title: str("Short title of the suggestion"),
        description: str("The suggestion in detail"),
        expectedBenefit: str("Expected benefit for students"),
        unitCode: str("Service unit code that should review it"),
        isAnonymous: {
          type: "boolean",
          description: "Submit without revealing the student's identity",
        },
      },
      ["title", "description"],
    ),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const title = String(args["title"] ?? "").slice(0, 160);
      const description = String(args["description"] ?? "").slice(0, 8000);
      if (!title || !description)
        return { ok: false, error: "Title and description are required." };

      const { submitInteraction } = await import("@/lib/interactions/intake.server");
      let result;
      try {
        result = await submitInteraction({
          studentId: ctx.userId,
          lang: ctx.lang,
          title,
          description,
          shortcutHint: "suggestion",
          channel: "chat",
          expectedBenefit: String(args["expectedBenefit"] ?? "").slice(0, 1000) || null,
          isAnonymous: Boolean(args["isAnonymous"]),
          unitId: (await unitByCode(ctx.db, (args["unitCode"] as string) ?? null))?.id ?? null,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Submission failed" };
      }

      return {
        ok: true,
        data: {
          suggestionId: result.kind === "suggestion" ? result.id : null,
          caseId: result.kind === "case" ? result.id : null,
          reference: result.reference,
          interactionType: result.interactionType,
          acknowledgement: ctx.lang === "ar" ? result.acknowledgementAr : result.acknowledgementEn,
        },
        reference: {
          referenceNumber: result.reference,
          actionType: `create_${result.interactionType}`,
          unitId: null,
          unitName: ctx.lang === "ar" ? result.classification.serviceLabel.ar : result.classification.serviceLabel.en,
          suggestionId: result.kind === "suggestion" ? result.id : null,
          caseId: result.kind === "case" ? result.id : null,
          expectedFirstResponseHours: 120,
          expectedResolutionDays: 14,
          trackingUrl: result.trackingUrl,
          nextStepEn: result.acknowledgementEn,
          nextStepAr: result.acknowledgementAr,
        },
      };
    },
  },
  {
    name: "book_appointment",
    agentType: "action",
    description:
      "Books one of the available appointment slots for the signed-in student. Requires student confirmation and a slot id from list_appointment_slots.",
    parameters: obj(
      {
        slotId: str("Slot id returned by list_appointment_slots"),
        purpose: str("Reason for the appointment"),
      },
      ["slotId"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const slotId = String(args["slotId"] ?? "");
      if (!slotId) return { ok: false, error: "A slot id is required." };
      const { data: slot } = await ctx.db
        .from("appointment_slots")
        .select(
          "id, start_time, capacity, booked_count, status, is_demo_record, appointment_types:appointment_type_id (name_en, name_ar, requires_approval, service_units:service_unit_id (id, name_en, name_ar))",
        )
        .eq("id", slotId)
        .maybeSingle();
      // Demo/seeded availability can never be booked by a student.
      if (!slot || slot.status !== "open" || slot.booked_count >= slot.capacity || slot.is_demo_record) {
        return bookingConflict(ctx, slotId, "slot_no_longer_open");
      }
      const type = slot.appointment_types as {
        name_en: string;
        name_ar: string;
        requires_approval: boolean;
        service_units: { id: string; name_en: string; name_ar: string } | null;
      } | null;

      // Single locked transaction: the slot is re-read FOR UPDATE, capacity and
      // duplicate/overlap rules are enforced, the booking and its audit record
      // are written together, and the slot counter can never exceed capacity.
      const { data: row, error } = await ctx.db.rpc("book_appointment_slot", {
        _slot_id: slotId,
        _purpose: String(args["purpose"] ?? "").slice(0, 500),
      });
      if (error || !row) return bookingConflict(ctx, slotId, error?.message ?? "booking_rejected");

      const { loadMyAppointments, notifyAppointmentParties } = await import("./appointment.server");
      const mine = await loadMyAppointments(ctx.db, false);
      const booked = mine.find((a) => a.appointmentId === row.id) ?? null;
      const { data: slotStaff } = await ctx.db
        .from("appointment_slots")
        .select("staff_profile_id")
        .eq("id", slotId)
        .maybeSingle();
      await notifyAppointmentParties({
        event: "appointment_booked",
        appointmentId: row.id,
        studentId: ctx.userId,
        staffUserId: slotStaff?.staff_profile_id ?? null,
        unitId: type?.service_units?.id ?? null,
        lang: ctx.lang,
        when: slot.start_time,
        staffName: booked?.staffName ?? null,
        unitLabel: type?.service_units
          ? ctx.lang === "ar"
            ? type.service_units.name_ar
            : type.service_units.name_en
          : null,
        place: booked?.meetingLink ?? booked?.location ?? null,
      });

      return {
        ok: true,
        data: {
          appointmentId: row.id,
          confirmationCode: row.confirmation_code,
          status: row.status,
          startTime: slot.start_time,
          staffName: booked?.staffName ?? null,
          staffEmail: booked?.staffEmail ?? null,
          location: booked?.location ?? null,
          meetingLink: booked?.meetingLink ?? null,
        },
        reference: {
          referenceNumber: row.confirmation_code,

          actionType: "book_appointment",
          unitId: type?.service_units?.id ?? null,
          unitName: type?.service_units
            ? ctx.lang === "ar"
              ? type.service_units.name_ar
              : type.service_units.name_en
            : null,
          appointmentId: row.id,
          expectedFirstResponseHours: 24,
          expectedResolutionDays: 1,
          trackingUrl: "/requests",
          nextStepEn:
            "Bring your student ID to the appointment. You can cancel from your requests page.",
          nextStepAr: "أحضر بطاقتك الجامعية إلى الموعد. يمكنك الإلغاء من صفحة طلباتك.",
        },
      };
    },
  },
  {
    name: "cancel_appointment",
    agentType: "action",
    description:
      "Cancels one of the signed-in student's own appointments and releases the slot. Requires student confirmation.",
    parameters: obj(
      {
        appointmentId: str("Appointment id from get_my_appointments"),
        reason: str("Optional reason for cancelling"),
      },
      ["appointmentId"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const appointmentId = String(args["appointmentId"] ?? "");
      if (!appointmentId) return { ok: false, error: "An appointment id is required." };
      const { loadMyAppointments, notifyAppointmentParties } = await import("./appointment.server");
      const before = (await loadMyAppointments(ctx.db, true)).find(
        (a) => a.appointmentId === appointmentId,
      );
      if (!before) return { ok: false, error: "APPOINTMENT_NOT_FOUND" };

      // Transactional: the appointment row and the slot counter move together.
      const reason = String(args["reason"] ?? "").slice(0, 300);
      const { error } = await ctx.db.rpc(
        "cancel_appointment_booking",
        (reason
          ? { _appointment_id: appointmentId, _reason: reason }
          : { _appointment_id: appointmentId }) as never,
      );
      if (error) return { ok: false, error: error.message };

      const { data: slotStaff } = await ctx.db
        .from("appointment_slots")
        .select("staff_profile_id, appointment_types:appointment_type_id (service_unit_id)")
        .eq("id", before.slotId)
        .maybeSingle();
      const unitId =
        (slotStaff?.appointment_types as { service_unit_id: string | null } | null)
          ?.service_unit_id ?? null;
      await notifyAppointmentParties({
        event: "appointment_cancelled",
        appointmentId,
        studentId: ctx.userId,
        staffUserId: slotStaff?.staff_profile_id ?? null,
        unitId,
        lang: ctx.lang,
        when: before.start,
        staffName: before.staffName,
        unitLabel: ctx.lang === "ar" ? before.unitNameAr : before.unitNameEn,
        place: before.meetingLink ?? before.location,
      });
      return {
        ok: true,
        data: { appointmentId, cancelled: true, releasedSlotId: before.slotId },
        reference: {
          referenceNumber: before.confirmationCode,
          actionType: "cancel_appointment",
          unitId,
          unitName: (ctx.lang === "ar" ? before.unitNameAr : before.unitNameEn) ?? null,
          appointmentId,
          trackingUrl: "/requests",
          nextStepEn: "The slot has been released and the unit has been informed.",
          nextStepAr: "تم تحرير الموعد وإبلاغ الوحدة المختصة.",
        },
      };
    },
  },
  {
    name: "reschedule_appointment",
    agentType: "action",
    description:
      "Moves one of the signed-in student's own appointments to another real open slot. Requires student confirmation.",
    parameters: obj(
      {
        appointmentId: str("Appointment id from get_my_appointments"),
        newSlotId: str("Slot id from list_appointment_slots"),
      },
      ["appointmentId", "newSlotId"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const appointmentId = String(args["appointmentId"] ?? "");
      const newSlotId = String(args["newSlotId"] ?? "");
      if (!appointmentId || !newSlotId) {
        return { ok: false, error: "An appointment id and a new slot id are required." };
      }
      // Transactional: the old slot is released and the new one locked and
      // taken in the same statement, so no double booking is possible.
      const { error } = await ctx.db.rpc("reschedule_appointment_booking", {
        _appointment_id: appointmentId,
        _new_slot_id: newSlotId,
      });
      if (error) return { ok: false, error: error.message };

      const { loadMyAppointments, notifyAppointmentParties } = await import("./appointment.server");
      const after = (await loadMyAppointments(ctx.db, false)).find(
        (a) => a.appointmentId === appointmentId,
      );
      const { data: slotStaff } = await ctx.db
        .from("appointment_slots")
        .select("staff_profile_id, appointment_types:appointment_type_id (service_unit_id)")
        .eq("id", newSlotId)
        .maybeSingle();
      const unitId =
        (slotStaff?.appointment_types as { service_unit_id: string | null } | null)
          ?.service_unit_id ?? null;
      if (after) {
        await notifyAppointmentParties({
          event: "appointment_changed",
          appointmentId,
          studentId: ctx.userId,
          staffUserId: slotStaff?.staff_profile_id ?? null,
          unitId,
          lang: ctx.lang,
          when: after.start,
          staffName: after.staffName,
          unitLabel: ctx.lang === "ar" ? after.unitNameAr : after.unitNameEn,
          place: after.meetingLink ?? after.location,
        });
      }
      return {
        ok: true,
        data: {
          appointmentId,
          newSlotId,
          startTime: after?.start ?? null,
          staffName: after?.staffName ?? null,
          location: after?.location ?? null,
          meetingLink: after?.meetingLink ?? null,
          confirmationCode: after?.confirmationCode ?? null,
        },
        reference: {
          referenceNumber: after?.confirmationCode ?? null,
          actionType: "reschedule_appointment",
          unitId,
          unitName: (ctx.lang === "ar" ? after?.unitNameAr : after?.unitNameEn) ?? null,
          appointmentId,
          trackingUrl: "/requests",
          nextStepEn: "Your appointment has been moved and both you and the unit were notified.",
          nextStepAr: "تم نقل موعدك وإبلاغك أنت والوحدة المختصة.",
        },
      };
    },
  },

  {
    name: "report_alert",
    agentType: "alert",
    description:
      "Raises an urgent alert (safety concern, serious immediate service disruption or emergency situation) on behalf of the signed-in student. Use only for urgent, ongoing situations — ordinary problems use create_complaint. Requires student confirmation.",
    parameters: obj(
      {
        title: str("Short title of the situation"),
        description: str("What is happening right now, in the student's words"),
        location: str("Building, room or campus location if known"),
        unitCode: str("Code or English name of the responsible service unit, when already verified (e.g. from the emergency register)"),
      },
      ["title", "description"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const title = String(args["title"] ?? "").slice(0, 160);
      const description = String(args["description"] ?? "").slice(0, 8000);
      if (!title || !description) return { ok: false, error: "Title and description are required." };

      // A verified unit from the emergency register (matched by code or English
      // name) wins over content-based routing, so "lost my wallet near the
      // library" still reaches security, not the library.
      let unitId: string | null = null;
      let unitNameEn: string | null = null;
      const unitCode = String(args["unitCode"] ?? "").trim().slice(0, 120);
      if (unitCode) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: units } = await supabaseAdmin
          .from("service_units")
          .select("id, code, name_en")
          .eq("is_active", true);
        const needle = unitCode.toLowerCase();
        const hit = (units ?? []).find(
          (u) => u.code?.toLowerCase() === needle || u.name_en?.toLowerCase() === needle,
        );
        unitId = hit?.id ?? null;
        unitNameEn = hit?.name_en ?? null;
      }

      const { submitInteraction } = await import("@/lib/interactions/intake.server");
      let result;
      try {
        result = await submitInteraction({
          studentId: ctx.userId,
          lang: ctx.lang,
          title,
          description,
          shortcutHint: "alert",
          channel: "chat",
          location: String(args["location"] ?? "").slice(0, 200) || null,
          unitId,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Submission failed" };
      }

      return {
        ok: true,
        data: {
          caseId: result.kind === "case" ? result.id : null,
          reference: result.reference,
          interactionType: result.interactionType,
          severity: result.classification.severity,
          acknowledgement: ctx.lang === "ar" ? result.acknowledgementAr : result.acknowledgementEn,
          // Approved institutional pathways only — never invented procedures.
          emergencyContacts: result.emergencyContacts,
        },
        reference: {
          referenceNumber: result.reference,
          actionType: "report_alert",
          unitId,
          unitName:
            unitNameEn ??
            (ctx.lang === "ar" ? result.classification.serviceLabel.ar : result.classification.serviceLabel.en),
          caseId: result.kind === "case" ? result.id : null,
          expectedFirstResponseHours: result.classification.severity === "critical" ? 1 : 2,
          expectedResolutionDays: 1,
          trackingUrl: result.trackingUrl,
          nextStepEn: result.acknowledgementEn,
          nextStepAr: result.acknowledgementAr,
        },
      };
    },
  },
  {
    name: "escalate_to_human",
    agentType: "case_management",
    description:
      "Hands the conversation to a human officer by opening a tracked case flagged for human review. Use for sensitive topics or when the student asks for a person. Requires student confirmation.",
    parameters: obj(
      { reason: str("Why human help is needed"), unitCode: str("Optional unit code") },
      ["reason"],
    ),
    risk: "level_2",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const reason = String(args["reason"] ?? "").slice(0, 2000);
      const unit = await unitByCode(ctx.db, (args["unitCode"] as string) ?? null);
      const { data: row, error } = await ctx.db
        .from("cases")
        .insert({
          case_number: "",
          student_id: ctx.userId,
          case_type: "query",
          title: ctx.lang === "ar" ? "طلب التحدث مع موظف" : "Request to speak with a staff member",
          description: reason,
          status: "submitted",
          urgency: "high",
          language: ctx.lang,
          service_unit_id: unit?.id ?? null,
          human_review_required: true,
          due_at: nowPlusHours(24),
        })
        .select("id, case_number")
        .single();
      if (error) return { ok: false, error: error.message };
      return {
        ok: true,
        data: { caseId: row.id, reference: row.case_number },
        reference: {
          referenceNumber: row.case_number,
          actionType: "escalate_to_human",
          unitId: unit?.id ?? null,
          unitName: unit ? (ctx.lang === "ar" ? unit.name_ar : unit.name_en) : null,
          caseId: row.id,
          expectedFirstResponseHours: 24,
          expectedResolutionDays: 3,
          trackingUrl: `/requests/${row.id}`,
          nextStepEn: "A staff member will reply in the case thread within one working day.",
          nextStepAr: "سيرد عليك موظف عبر سجل الحالة خلال يوم عمل واحد.",
        },
      };
    },
  },
  {
    name: "mark_alert_read",
    agentType: "alert",
    description:
      "Marks one of the signed-in student's alerts as read. Requires student confirmation.",
    parameters: obj({ alertId: str("Alert id from get_my_alerts") }, ["alertId"]),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: true,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const alertId = String(args["alertId"] ?? "");
      const { error } = await ctx.db
        .from("student_alerts")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", alertId)
        .eq("student_id", ctx.userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { alertId, read: true } };
    },
  },
];


/* ------------------------------------------------------------------ */
/* Official document tools (To Whom It May Concern letter)             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Career counselling tools                                            */
/* ------------------------------------------------------------------ */

const careerTools: ToolDefinition[] = [
  {
    name: "get_career_cv_status",
    agentType: "career",
    description:
      "Returns whether the signed-in student has uploaded a CV to Sanadi, when it was uploaded and whether it was parsed successfully.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx) {
      const { loadCurrentCv } = await import("../career/career.server");
      const cv = await loadCurrentCv(ctx.db, ctx.userId);
      return {
        ok: true,
        data: cv
          ? {
              hasCv: true,
              fileName: cv.file_name,
              uploadedAt: cv.uploaded_at,
              parsingStatus: cv.parsing_status,
              language: cv.detected_language,
            }
          : {
              hasCv: false,
              note: "Ask the student to upload their CV on the Career Counselling page (/career) so the analysis can run.",
            },
      };
    },
  },
  {
    name: "analyze_career_fit",
    agentType: "career",
    description:
      "Runs the deterministic career fit engine. Works with or without a CV: without a CV it returns preliminary matches from the verified academic record; with a CV it returns CV-enhanced matches with score breakdowns, evidence and gaps.",
    parameters: obj({ targetRoleCode: str("Optional career role code to focus the analysis on") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { analyseCareer } = await import("../career/career.server");
      const targetRoleCode =
        typeof args["targetRoleCode"] === "string" ? args["targetRoleCode"] : null;
      const r = await analyseCareer(ctx.db, ctx.userId, { targetRoleCode, limit: 5, persist: false });
      return {
        ok: true,
        data: {
          hasCv: r.hasCv,
          profileSource: r.profileSource,
          profileUsed: r.hasCv ? "Academic record + CV" : "Academic record only",
          cvFileName: r.cvFileName,
          analysisVersion: r.versionNo,
          previousTopRoles: r.previousVersion?.topRoles ?? null,
          rankingChangeExplanation: r.rankingChange
            ? ctx.lang === "ar"
              ? r.rankingChange.ar
              : r.rankingChange.en
            : null,
          programme: r.evidence.programmeEn,
          gpa: r.evidence.gpa,
          completedCredits: r.evidence.completedCredits,
          matches: r.matches.map((m) => ({
            role: ctx.lang === "ar" ? m.titleAr : m.titleEn,
            roleCode: m.roleCode,
            fitScore: m.fitScore,
            jobReadinessScore: m.jobReadinessScore,
            breakdown: m.breakdown,
            evidence: m.evidenceItems.map(
              (e) => `${ctx.lang === "ar" ? e.textAr : e.textEn} [${e.source}]`,
            ),
            gaps: m.missingRequirements,
          })),
          skillGaps: r.skillGaps,
          discrepancies: r.discrepancies,
          note: r.hasCv
            ? "Scores are calculated deterministically from the CV and the student's verified records. University records win over any conflicting CV claim. Do not invent scores."
            : "These are preliminary matches based on the academic record only. Tell the student they can upload a CV at /career for a more accurate, evidence-based analysis. Do not invent scores.",
        },
        citations: [
          recordCitation(
            "UAEU career role requirements register",
            "سجل متطلبات الأدوار المهنية",
            "Career Services",
            ctx.lang,
          ),
        ],
      };
    },
  },

  {
    name: "get_ats_score",
    agentType: "career",
    description:
      "Returns the deterministic 100-point ATS assessment of the student's CV against a target role, with section scores, strengths, improvements and recommended keywords.",
    parameters: obj({ targetRoleCode: str("Optional career role code to score the CV against") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { analyseCareer } = await import("../career/career.server");
      const targetRoleCode =
        typeof args["targetRoleCode"] === "string" ? args["targetRoleCode"] : null;
      const r = await analyseCareer(ctx.db, ctx.userId, { targetRoleCode, limit: 3, persist: false });
      if (!r.hasCv || !r.ats)
        return {
          ok: true,
          data: {
            hasCv: false,
            note: "No readable CV on file. Ask the student to upload one at /career.",
          },
        };
      return { ok: true, data: { hasCv: true, ats: r.ats, injectionFlagged: r.injectionFlagged } };
    },
  },
  {
    name: "generate_career_action_plan",
    agentType: "career",
    description:
      "Returns the student's personalised 30-day, 90-day and pre-graduation career action plan derived from their skill gaps, coursework.",
    parameters: obj({ targetRoleCode: str("Optional career role code the plan should target") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { analyseCareer } = await import("../career/career.server");
      const targetRoleCode =
        typeof args["targetRoleCode"] === "string" ? args["targetRoleCode"] : null;
      const r = await analyseCareer(ctx.db, ctx.userId, { targetRoleCode, limit: 3, persist: false });
      // A plan is still useful without a CV — it is just preliminary.
      return {
        ok: true,
        data: {
          hasCv: r.hasCv,
          profileUsed: r.hasCv ? "Academic record + CV" : "Academic record only",
          targetRole: r.matches[0]
            ? ctx.lang === "ar"
              ? r.matches[0].titleAr
              : r.matches[0].titleEn
            : null,
          plan: r.actionPlan.map((p) => ({
            horizon: p.horizon,
            title: ctx.lang === "ar" ? p.titleAr : p.titleEn,
            detail: ctx.lang === "ar" ? p.detailAr : p.detailEn,
          })),
          note: r.hasCv
            ? undefined
            : "Preliminary plan from the academic record only; suggest uploading a CV at /career for a sharper plan.",
        },
      };
    },
  },
  {
    name: "review_my_cv",
    agentType: "career",
    description:
      "Reviews the signed-in student's saved CV using Sanadi's deterministic engine: strengths, weaknesses, ATS issues, date problems, missing keywords and differences against the university record. Never invent findings; use only what this tool returns.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx) {
      const { runCareerChat } = await import("../career/chat.server");
      const r = await runCareerChat(ctx.db, ctx.userId, ctx.lang, "cv_review");
      return {
        ok: true,
        data: {
          hasCv: r.card.cv.hasCv,
          cvFileName: r.card.cv.fileName,
          ats: r.card.ats,
          review: r.answer,
          card: r.card,
          note: r.card.cv.hasCv
            ? "All findings are deterministic. Present them as they are."
            : "No CV on file: give academic-only guidance and offer the Upload CV action at /career.",
        },
      };
    },
  },
  {
    name: "get_interview_preparation",
    agentType: "career",
    description:
      "Returns interview questions for the signed-in student's best-matching (or a named) career role, built from that role's own requirements and the student's verified record and CV evidence. Use it before coaching a student on interviews.",
    parameters: obj({ targetRoleCode: str("Optional career role code to prepare for.") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { runCareerChat } = await import("../career/chat.server");
      const code = typeof args["targetRoleCode"] === "string" ? (args["targetRoleCode"] as string) : null;
      const r = await runCareerChat(ctx.db, ctx.userId, ctx.lang, "interview", code);
      return {
        ok: true,
        data: {
          targetRole: r.card.matches[0]?.title ?? null,
          preparation: r.answer,
          strengths: r.card.skillGaps?.strong ?? [],
          gaps: r.card.skillGaps?.missing ?? [],
          card: r.card,
          note: "Coach the student on their answers using Situation–Task–Action–Result. Do not claim any score that is not in this payload.",
        },
      };
    },
  },
  {
    name: "request_career_counsellor",
    agentType: "career",
    description:
      "Creates a real Career Counselling request for the signed-in student through the institutional intake pipeline: routing to Career and Internship Services, owner assignment, SLA and tracking. Repeated calls return the existing open request instead of duplicating it. Use it as soon as the student asks to see or speak to a counsellor.",
    parameters: obj({ note: str("The student's own reason for asking, in their words.") }),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { createCounsellingRequest } = await import("../career/counselling.server");
      const raw = args["note"];
      const note = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 1000) : null;
      const result = await createCounsellingRequest({
        supabase: ctx.db,
        studentId: ctx.userId,
        note,
        lang: ctx.lang,
      });
      return {
        ok: true,
        reference: {
          referenceNumber: result.request.reference,
          actionType: "career_counselling_request",
          unitId: null,
          unitName: "Career and Internship Services",
          caseId: result.request.id,
          trackingUrl: `/requests/${result.request.id}`,
          nextStepEn: "Career and Internship Services will reply in your request thread.",
          nextStepAr: "سيرد قسم الخدمات المهنية والتدريب في مسار طلبك.",
        },
        data: {
          created: result.created,
          alreadyOpen: !result.created,
          reference: result.request.reference,
          status: result.request.status,
          expectedFirstResponseAt: result.request.firstResponseDueAt,
          trackingUrl: `/requests/${result.request.id}`,
          acknowledgement: result.acknowledgement,
        },
      };
    },
  },
];

const documentTools: ToolDefinition[] = [
  {
    name: "check_enrollment_letter_readiness",
    agentType: "document",
    description:
      "Checks whether an official enrollment / To Whom It May Concern letter can be issued for the signed-in student, and returns the verified record that will appear on it plus any letters already issued.",
    parameters: obj({}),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx) {
      const { loadLetterContext, listMyDocuments } = await import("../documents/letters.server");
      const [letter, documents] = await Promise.all([
        loadLetterContext(ctx.db, ctx.userId),
        listMyDocuments(ctx.db, ctx.userId, { page: 1, pageSize: 5 }),
      ]);
      return {
        ok: true,
        data: {
          canIssue: letter.eligible,
          blockingReason: ctx.lang === "ar" ? letter.blockingReasonAr : letter.blockingReason,
          verifiedRecord: {
            studentName: letter.studentName,
            studentNumber: letter.studentNumber,
            programme: ctx.lang === "ar" ? letter.programmeAr : letter.programmeEn,
            college: ctx.lang === "ar" ? letter.collegeAr : letter.collegeEn,
            academicTerm: ctx.lang === "ar" ? letter.termAr : letter.termEn,
            enrollmentStatus: letter.enrollmentStatus,
            expectedGraduation: letter.expectedGraduation,
          },
          defaultContent:
            "Name, student number, programme, college, current term and confirmation of active enrollment.",
          optionalContent: "Expected graduation date (only if the student asks for it).",
          existingLetters: documents.items,
          note: "This service is instant and fully automated. Do NOT ask the student to confirm anything and do not repeat details they already gave. If the letter language is known, call issue_enrollment_letter now; purpose defaults to general. Ask only for a genuinely missing required field (language).",
        },
        citations: [
          recordCitation(
            "UAEU student enrollment record",
            "سجل قيد الطالب بجامعة الإمارات",
            "Registration and Admission",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "issue_enrollment_letter",
    agentType: "document",
    description:
      "Generates the official To Whom It May Concern / enrollment letter as a verifiable PDF for the signed-in student. Instant: call it as soon as the language is known (purpose defaults to general). Never ask for an extra confirmation first.",
    parameters: obj(
      {
        language: enumStr("Letter language chosen by the student: English or Arabic.", [
          "en",
          "ar",
        ]),
        purpose: enumStr("What the letter is for", [
          "general",
          "embassy_visa",
          "bank",
          "employer",
          "scholarship",
          "government",
          "other",
        ]),
        includeExpectedGraduation: {
          type: "boolean",
          description:
            "Include the estimated expected graduation date. Only when the student asked for it.",
        },
      },
      ["language"],
    ),
    risk: "level_1",
    readOnly: false,
    // Instant, reversible, student-owned document: no "are you sure" step.
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { issueEnrollmentLetter } = await import("../documents/letters.server");
      const language = args["language"] === "ar" ? ("ar" as const) : ("en" as const);
      const purposeArg = String(args["purpose"] ?? "general");
      const purpose = (
        [
          "general",
          "embassy_visa",
          "bank",
          "employer",
          "scholarship",
          "government",
          "other",
        ].includes(purposeArg)
          ? purposeArg
          : "general"
      ) as "general";
      try {
        const { letter, replayed } = await issueEnrollmentLetter({
          db: ctx.db,
          userId: ctx.userId,
          language,
          purpose,
          fields: { includeExpectedGraduation: args["includeExpectedGraduation"] === true },
          conversationId: ctx.conversationId ?? null,
          generatedBy: "agent",
        });
        return {
          ok: true,
          data: { ...letter, replayed, downloadPath: "/documents" },
          reference: {
            referenceNumber: letter.referenceNumber,
            actionType: "issue_enrollment_letter",
            unitId: null,
            unitName: "Registration and Admission",
            expectedFirstResponseHours: 0,
            expectedResolutionDays: 0,
            trackingUrl: "/documents",
            nextStepEn: `Your letter ${letter.referenceNumber} has been issued and is ready to download from My Documents. It carries a QR code that anyone can use to verify it online.`,
            nextStepAr: `تم إصدار شهادتك برقم ${letter.referenceNumber} وهي جاهزة للتنزيل من "وثائقي"، وتحمل رمز استجابة سريعة للتحقق من صحتها إلكترونياً.`,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "The letter could not be issued.",
        };
      }
    },
  },
];

const availabilityTools: ToolDefinition[] = [
  {
    name: "check_service_availability",
    agentType: "action",
    description:
      "Checks whether a university service is currently open for students, and when the next application period opens and closes. Use this BEFORE promising that a service can be completed. Service codes: SVC-CAREER-COUNSEL (career counselling), SVC-DOC-TWIMC (to whom it may concern letter).",
    parameters: obj({ serviceCode: str("Service code, e.g. SVC-CAREER-COUNSEL") }, [
      "serviceCode",
    ]),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { getServiceAvailability, availabilityMessage, formatUae } =
        await import("../services/availability.server");
      const a = await getServiceAvailability(ctx.db, String(args["serviceCode"] ?? ""));
      return {
        ok: true,
        data: {
          serviceCode: a.serviceCode,
          serviceName: ctx.lang === "ar" ? a.serviceNameAr : a.serviceNameEn,
          isOpen: a.isAvailable,
          status: a.status,
          opensAt: formatUae(a.opensAt, ctx.lang),
          closesAt: formatUae(a.closesAt, ctx.lang),
          nextOpenAt: formatUae(a.nextOpenAt, ctx.lang),
          nextCloseAt: formatUae(a.nextCloseAt, ctx.lang),
          preliminaryCheckAllowed: a.preliminaryCheckAllowed,
          remindersAvailable: a.remindersEnabled && !a.isAvailable && !!a.nextOpenAt,
          message: availabilityMessage(a, ctx.lang),
        },
      };
    },
  },
  {
    name: "set_service_reminder",
    agentType: "action",
    description:
      "Registers the signed-in student for a reminder when a closed service opens again. Only use after check_service_availability shows the service is closed and reminders are available.",
    parameters: obj({ serviceCode: str("Service code, e.g. SVC-CAREER-COUNSEL") }, [
      "serviceCode",
    ]),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { createServiceReminder, formatUae } = await import("../services/availability.server");
      try {
        const res = await createServiceReminder(
          ctx.db,
          ctx.userId,
          String(args["serviceCode"] ?? ""),
        );
        return {
          ok: true,
          data: {
            reminderId: res.id,
            alreadyExisted: res.alreadyExisted,
            willNotifyOn: formatUae(res.scheduledFor, ctx.lang),
            nextStepEn: "I will notify you as soon as this service opens.",
            nextStepAr: "سأخطرك فور فتح هذه الخدمة.",
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not set the reminder.",
        };
      }
    },
  },
];

/* ------------------------------------------------------------------ */
/* Ask the Librarian tools                                             */
/* ------------------------------------------------------------------ */

const DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const libraryTools: ToolDefinition[] = [
  {
    name: "get_library_hours",
    agentType: "query",
    description:
      "Returns live library opening hours and whether each branch is open right now, computed in UAE time (Asia/Dubai) from the published schedule and holiday exceptions.",
    parameters: obj({ branch: str("Optional branch code, e.g. MAIN or SCI") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { getLibraryHours } = await import("../library/hours.server");
      const branch = (args["branch"] as string | undefined) ?? null;
      const statuses = await getLibraryHours(ctx.db, branch);
      if (!statuses.length) return { ok: false, error: "No library branch information is published yet." };
      const days = ctx.lang === "ar" ? DAY_NAMES_AR : DAY_NAMES_EN;
      return {
        ok: true,
        data: {
          checkedAtLocalTime: statuses[0]!.localTime,
          timezone: statuses[0]!.timezone,
          branches: statuses.map((s) => ({
            branch: s.location.code,
            name: ctx.lang === "ar" ? s.location.nameAr : s.location.nameEn,
            building: ctx.lang === "ar" ? s.location.buildingAr : s.location.buildingEn,
            isOpenNow: s.isOpenNow,
            todayOpensAt: s.todayOpensAt,
            todayClosesAt: s.todayClosesAt,
            closesInMinutes: s.closesInMinutes,
            specialSchedule: ctx.lang === "ar" ? s.exceptionReasonAr : s.exceptionReasonEn,
            nextOpen:
              s.nextOpenDay === null ? null : `${days[s.nextOpenDay]} ${s.nextOpenAt}`,
            weeklyHours: s.week.map((d) => ({
              day: days[d.dayOfWeek],
              closed: d.closed,
              opensAt: d.opensAt,
              closesAt: d.closesAt,
            })),
            contactEmail: s.location.contactEmail,
            contactPhone: s.location.contactPhone,
          })),
        },
        citations: [
          recordCitation("UAEU Library published opening hours", "ساعات عمل مكتبة جامعة الإمارات المعتمدة", ctx.lang === "ar" ? "خدمات المكتبة" : "Library Services", ctx.lang),
        ],
      };
    },
  },
  {
    name: "get_library_service_info",
    agentType: "query",
    description:
      "Returns approved library service information: borrowing and renewal rules, study rooms, printing, device loans, databases, interlibrary loan, research support and accessibility services.",
    parameters: obj({ topic: str("Optional topic, e.g. borrowing, study rooms, printing, databases") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { getLibraryServices } = await import("../library/hours.server");
      const services = await getLibraryServices(ctx.db, (args["topic"] as string | undefined) ?? null);
      if (!services.length) return { ok: false, error: "No library service information is published yet." };
      const ar = ctx.lang === "ar";
      return {
        ok: true,
        data: {
          services: services.slice(0, 6).map((s) => ({
            key: s.key,
            name: ar ? s.nameAr : s.nameEn,
            description: ar ? s.descriptionAr : s.descriptionEn,
            eligibility: ar ? s.eligibilityAr : s.eligibilityEn,
            howToUse: ar ? s.instructionsAr : s.instructionsEn,
            availability: ar ? s.availabilityAr : s.availabilityEn,
            url: s.url,
          })),
        },
        citations: [
          recordCitation("UAEU Library service catalogue", "دليل خدمات مكتبة جامعة الإمارات", ar ? "خدمات المكتبة" : "Library Services", ctx.lang),
        ],
      };
    },
  },
  {
    name: "search_library_catalogue",
    agentType: "knowledge",
    description:
      "Searches the university library catalogue for books, e-books, journals, articles, theses and databases. Returns availability, physical location (branch, floor, shelf, call number) and electronic access links. Never invent results: if the response is not ok, tell the student the catalogue is unavailable and offer to ask a librarian.",
    parameters: obj({
      query: str("Free-text search terms"),
      title: str("Optional exact title"),
      author: str("Optional author name"),
      subject: str("Optional subject or topic"),
      isbn: str("Optional ISBN"),
      yearFrom: { type: "number", description: "Earliest publication year" },
      yearTo: { type: "number", description: "Latest publication year" },
      resourceType: enumStr("Optional resource type filter", [
        "book",
        "ebook",
        "journal",
        "article",
        "thesis",
        "database",
      ]),
      availableOnly: { type: "boolean", description: "Only items available now" },
      electronicOnly: { type: "boolean", description: "Only items with online access" },
    }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { searchCatalogue, applyClientFilters, parseSearchIntent, logSearchEvent } = await import(
        "../library/provider.server"
      );
      const freeText = String(args["query"] ?? "").slice(0, 300);
      const parsed = freeText ? parseSearchIntent(freeText) : {};
      const params = {
        ...parsed,
        ...(args["title"] ? { title: String(args["title"]) } : {}),
        ...(args["author"] ? { author: String(args["author"]) } : {}),
        ...(args["subject"] ? { subject: String(args["subject"]) } : {}),
        ...(args["isbn"] ? { isbn: String(args["isbn"]) } : {}),
        ...(args["yearFrom"] ? { yearFrom: Number(args["yearFrom"]) } : {}),
        ...(args["yearTo"] ? { yearTo: Number(args["yearTo"]) } : {}),
        ...(args["resourceType"] ? { types: [String(args["resourceType"])] as never } : {}),
        ...(args["availableOnly"] ? { availableOnly: true } : {}),
        ...(args["electronicOnly"] ? { electronicOnly: true } : {}),
        limit: 10,
      };
      const res = await searchCatalogue({ db: ctx.db, params });
      const results = applyClientFilters(res.results, params).slice(0, 10);
      await logSearchEvent(ctx.db, {
        studentId: ctx.userId,
        searchType: "assistant",
        language: ctx.lang,
        queryTerms: freeText || (params.title ?? params.author ?? params.subject ?? null),
        resultCount: results.length,
        providerStatus: res.status,
        latencyMs: res.latencyMs,
        errorCode: res.error,
      });

      if (res.status === "disabled" || res.status === "unavailable" || res.status === "error") {
        return {
          ok: false,
          error:
            ctx.lang === "ar"
              ? "لا يمكن الوصول إلى فهرس المكتبة الآن، ولن أعرض نتائج غير مؤكدة. يمكنني توجيه سؤالك إلى أمين المكتبة."
              : "The library catalogue cannot be reached right now, and I will not show unverified results. I can pass your question to a librarian.",
        };
      }

      const ar = ctx.lang === "ar";
      const typeLabel = (t: string) =>
        ar
          ? ({ book: "كتاب", ebook: "كتاب إلكتروني", journal: "دورية", article: "مقال", thesis: "أطروحة", database: "قاعدة بيانات" } as Record<string, string>)[t] ?? t
          : ({ book: "Book", ebook: "E-book", journal: "Journal", article: "Article", thesis: "Thesis", database: "Database" } as Record<string, string>)[t] ?? t;
      const availabilityLabel = (a: string) =>
        ar
          ? ({ available: "متاح", on_loan: "معار", reference_only: "للاطلاع الداخلي", electronic: "متاح إلكترونياً", in_processing: "قيد المعالجة", unavailable: "غير متاح", unknown: "غير معروف" } as Record<string, string>)[a] ?? a
          : ({ available: "Available", on_loan: "Checked out", reference_only: "Reference only", electronic: "Online", in_processing: "In processing", unavailable: "Unavailable", unknown: "Unknown" } as Record<string, string>)[a] ?? a;

      // Client-safe card: the chat renders verified catalogue data directly, so
      // the model never restates (or invents) holdings and availability.
      const card = {
        query: freeText || params.title || params.author || params.subject || "",
        provider: res.provider ?? null,
        totalMatches: res.total ?? results.length,
        retrievedAt: new Date().toISOString(),
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          authors: r.authors ?? [],
          year: r.year ?? null,
          type: r.type,
          typeLabel: typeLabel(r.type),
          availability: r.availability,
          availabilityLabel: availabilityLabel(r.availability),
          library: r.holdings[0]?.library ?? null,
          floor: r.holdings[0]?.floor ?? null,
          shelf: r.holdings[0]?.shelf ?? null,
          callNumber: r.holdings[0]?.callNumber ?? null,
          onlineUrl: r.onlineUrl ?? null,
          catalogueUrl: r.catalogueUrl ?? null,
          subjects: (r.subjects ?? []).slice(0, 4),
        })),
      };

      return {
        ok: true,
        data: {
          provider: res.provider,
          totalMatches: res.total,
          shown: Math.min(results.length, 5),
          libraryCard: card,
          renderedAsCards: true,
          searchUsed: { query: params.query ?? null, title: params.title ?? null, author: params.author ?? null },
          results: results.slice(0, 5).map((r) => ({
            id: r.id,
            title: r.title,
            authors: r.authors,
            year: r.year,
            type: r.type,
            availability: r.availability,
            location: r.holdings[0]
              ? {
                  library: r.holdings[0].library,
                  floor: r.holdings[0].floor,
                  shelf: r.holdings[0].shelf,
                  callNumber: r.holdings[0].callNumber,
                }
              : null,
            onlineAccessUrl: r.onlineUrl,
            catalogueUrl: r.catalogueUrl,
          })),
        },
        citations: [
          recordCitation(
            `Library catalogue (${res.provider ?? "UAEU Library"})`,
            `فهرس المكتبة (${res.provider ?? "مكتبة الجامعة"})`,
            ctx.lang === "ar" ? "خدمات المكتبة" : "Library Services",
            ctx.lang,
          ),
        ],
      };
    },
  },
  {
    name: "build_library_citation",
    agentType: "knowledge",
    description:
      "Builds an APA, IEEE or Harvard citation from verified catalogue metadata for a record returned by search_library_catalogue. Fields that are missing from the catalogue are reported, never invented.",
    parameters: obj(
      {
        recordId: str("Record id from search_library_catalogue"),
        style: enumStr("Citation style", ["apa", "ieee", "harvard"]),
      },
      ["recordId", "style"],
    ),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student", "staff"],
    async run(ctx, args) {
      const { searchCatalogue } = await import("../library/provider.server");
      const { isOclcConfigured, getRecordDetails } = await import("../library/oclc.server");
      const { buildCitation } = await import("../library/types");
      const recordId = String(args["recordId"] ?? "");
      // Prefer the full OCLC bib record: it carries the metadata citations need.
      const direct = isOclcConfigured() ? await getRecordDetails(recordId).catch(() => null) : null;
      const res = direct ? null : await searchCatalogue({ db: ctx.db, params: { query: recordId, limit: 10 } });
      const record = direct ?? res?.results.find((r) => r.id === recordId);
      if (!record)
        return {
          ok: false,
          error:
            ctx.lang === "ar"
              ? "تعذّر استرجاع بيانات هذا المرجع من الفهرس، ولا يمكنني إنشاء اقتباس غير موثّق."
              : "That record could not be retrieved from the catalogue, so I cannot build a verified citation.",
        };
      const citation = buildCitation(record, String(args["style"]) as "apa" | "ieee" | "harvard");
      return { ok: true, data: { ...citation, title: record.title } };
    },
  },
  {
    name: "ask_a_librarian",
    agentType: "case_management",
    description:
      "Sends the student's library question to Library Services when the catalogue, hours or service information cannot answer it. Routes through the standard intake pipeline: the request is classified, assigned to the library owner, given an SLA and tracked in My Requests. Repeated asks return the existing open request instead of creating a duplicate.",
    parameters: obj(
      { question: str("The student's library question"), details: str("Optional extra details") },
      ["question"],
    ),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: ["student"],
    async run(ctx, args) {
      const { createLibrarianRequest } = await import("../library/librarian.server");
      const unit = await unitByCode(ctx.db, "LIB");
      try {
        const { created, request, acknowledgement } = await createLibrarianRequest({
          db: ctx.db as never,
          studentId: ctx.userId,
          question: String(args["question"] ?? ""),
          details: (args["details"] as string | undefined) ?? null,
          lang: ctx.lang,
          conversationId: (ctx as { conversationId?: string | null }).conversationId ?? null,
        });
        return {
          ok: true,
          data: {
            caseId: request.id,
            reference: request.reference,
            status: request.status,
            alreadyOpen: !created,
            acknowledgement,
          },
          reference: {
            referenceNumber: request.reference,
            actionType: "ask_a_librarian",
            unitId: unit?.id ?? null,
            unitName: unit ? (ctx.lang === "ar" ? unit.name_ar : unit.name_en) : "Library Services",
            caseId: request.id,
            expectedFirstResponseHours: 24,
            expectedResolutionDays: 2,
            trackingUrl: `/requests/${request.id}`,
            nextStepEn: "A librarian will reply in your request thread within one working day.",
            nextStepAr: "سيرد أمين المكتبة على طلبك خلال يوم عمل واحد.",
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Library request could not be created." };
      }
    },
  },
];


export const TOOL_REGISTRY: ToolDefinition[] = [
  ...caseFollowupTools,
  ...readTools,
  ...writeTools,
  ...documentTools,
  ...careerTools,
  ...availabilityTools,
  ...libraryTools,
];

export const toolByName = (name: string) => TOOL_REGISTRY.find((t) => t.name === name) ?? null;

/** Server-side authorisation: role membership plus the DB governance record. */
export type ToolGovernance = {
  enabled: boolean;
  allowedRoles: string[];
  risk: ActionRisk;
  confirmationRequired: boolean;
  humanApprovalRequired: boolean;
  toolId: string | null;
};

export async function loadGovernance(_db: Db): Promise<Map<string, ToolGovernance>> {
  const map = new Map<string, ToolGovernance>();
  // The tool catalogue is staff-restricted at the RLS level; read it with the
  // trusted server client instead of the caller's session.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as unknown as Db)
    .from("agent_tools")
    .select(
      "id, tool_name, enabled, allowed_roles, risk_level, confirmation_required, human_approval_required",
    );
  for (const row of data ?? []) {
    map.set(row.tool_name, {
      enabled: row.enabled,
      allowedRoles: Array.isArray(row.allowed_roles) ? (row.allowed_roles as string[]) : [],
      risk: row.risk_level,
      confirmationRequired: row.confirmation_required,
      humanApprovalRequired: row.human_approval_required,
      toolId: row.id,
    });
  }
  return map;
}

export function authorizeTool(
  tool: ToolDefinition,
  governance: ToolGovernance | undefined,
  roles: string[],
): { allowed: boolean; reason?: string } {
  if (governance && !governance.enabled) return { allowed: false, reason: "tool_disabled" };
  const required = governance?.allowedRoles?.length ? governance.allowedRoles : tool.allowedRoles;
  if (required.includes("student") && roles.includes("student")) return { allowed: true };
  if (required.includes("staff") && roles.some((r) => r !== "student")) return { allowed: true };
  if (required.some((r) => roles.includes(r))) return { allowed: true };
  return { allowed: false, reason: "role_not_permitted" };
}
