/**
 * Case continuity tools. Server only.
 *
 * These let a student run the whole journey in plain language — add
 * information, change what they submitted, ask about a result, request a
 * correction, raise an objection — without a form and without starting a new
 * request. Every tool works on the student's OWN case, resolved from the
 * session user id, never from an identity supplied by the model.
 */
import type { ToolDefinition, ToolResult } from "./tools.server";
import {
  amendCaseDetails,
  appendCaseUpdate,
  buildCaseResultCard,
  openCaseReview,
  resolveStudentCase,
  type ReviewKind,
} from "../cases/followup.server";

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });

const STUDENT_ROLES = ["student"];

const notFound = (lang: string): ToolResult => ({
  ok: false,
  error:
    lang === "ar"
      ? "لم أجد طلبًا مسجلاً باسمك لأتابعه. أخبرني بالرقم المرجعي إن كان لديك."
      : "I could not find a request of yours to follow up on. Share the reference number if you have it.",
});

export const caseFollowupTools: ToolDefinition[] = [
  {
    name: "get_case_result",
    agentType: "cases",
    description:
      "Show the decided result of the student's request: outcome, date, responsible unit and staff member, explanation and next steps. Use whenever the student asks what happened to a request or what the result was.",
    parameters: obj({ reference: str("Case reference number, if the student mentioned one.") }),
    risk: "level_0",
    readOnly: true,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: STUDENT_ROLES,
    run: async (ctx, args) => {
      const kase = await resolveStudentCase(ctx.db, ctx.userId, {
        reference: (args["reference"] as string) ?? null,
        prefer: "decided",
      });
      if (!kase) return notFound(ctx.lang);
      const card = await buildCaseResultCard(ctx.db, kase, ctx.lang);
      return { ok: true, data: { caseResultCard: card } };
    },
  },
  {
    name: "add_case_information",
    agentType: "cases",
    description:
      "Attach extra information the student wants to add to an existing request ('I want to add something to my complaint'). Keeps the same case and notifies the responsible staff member.",
    parameters: obj(
      {
        information: str("The additional information, in the student's own words."),
        reference: str("Case reference number, if the student mentioned one."),
      },
      ["information"],
    ),
    risk: "level_0",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: STUDENT_ROLES,
    run: async (ctx, args) => {
      const kase = await resolveStudentCase(ctx.db, ctx.userId, {
        reference: (args["reference"] as string) ?? null,
        prefer: "open",
      });
      if (!kase) return notFound(ctx.lang);
      const info = String(args["information"] ?? "").trim();
      if (!info) return { ok: false, error: "No information provided." };
      const res = await appendCaseUpdate({
        db: ctx.db,
        kase,
        studentId: ctx.userId,
        body: info,
        lang: ctx.lang,
      });
      const card = await buildCaseResultCard(ctx.db, kase, ctx.lang);
      return { ok: true, data: { added: true, ...res, caseResultCard: card } };
    },
  },
  {
    name: "modify_case_request",
    agentType: "cases",
    description:
      "Change the details of a request the student already submitted ('I want to change the details I submitted', 'this information is incorrect'). The previous version is kept for audit. Only works while the request is still open.",
    parameters: obj(
      {
        description: str("The corrected description of the request."),
        desired_outcome: str("The corrected outcome the student is asking for."),
        reference: str("Case reference number, if the student mentioned one."),
      },
      [],
    ),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: STUDENT_ROLES,
    run: async (ctx, args) => {
      const kase = await resolveStudentCase(ctx.db, ctx.userId, {
        reference: (args["reference"] as string) ?? null,
        prefer: "open",
      });
      if (!kase) return notFound(ctx.lang);
      try {
        const res = await amendCaseDetails({
          db: ctx.db,
          kase,
          studentId: ctx.userId,
          description: (args["description"] as string) ?? null,
          desiredResolution: (args["desired_outcome"] as string) ?? null,
          lang: ctx.lang,
        });
        const card = await buildCaseResultCard(ctx.db, kase, ctx.lang);
        return { ok: true, data: { modified: true, ...res, caseResultCard: card } };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "failed";
        if (reason === "decided") {
          return {
            ok: false,
            error:
              ctx.lang === "ar"
                ? "هذا الطلب تم البت فيه، لذا لا يمكن تعديله. يمكنني تسجيل طلب تصحيح أو اعتراض على نفس الطلب."
                : "This request has already been decided, so its details cannot be edited. I can record a correction request or an objection on the same request instead.",
          };
        }
        if (reason === "nothing_to_change") {
          return {
            ok: false,
            error:
              ctx.lang === "ar"
                ? "أحتاج معرفة ما الذي تريد تغييره بالضبط."
                : "I need to know exactly what you would like to change.",
          };
        }
        return { ok: false, error: "The request could not be updated." };
      }
    },
  },
  {
    name: "raise_case_review",
    agentType: "cases",
    description:
      "Record a question, a correction request or an objection against a decided result ('I disagree with this result', 'can you reconsider my request'). Keeps the same case, preserves the original decision and routes it to an authorised reviewer. kind: question | correction | objection.",
    parameters: obj(
      {
        kind: {
          type: "string",
          description: "question = ask about the result; correction = fix a factual error; objection = formally disagree.",
          enum: ["question", "correction", "objection"],
        },
        reason: str("Why the student is questioning, correcting or objecting, in their own words."),
        requested_outcome: str("The outcome the student is asking for instead, if stated."),
        reference: str("Case reference number, if the student mentioned one."),
      },
      ["kind", "reason"],
    ),
    risk: "level_1",
    readOnly: false,
    confirmationRequired: false,
    humanApprovalRequired: false,
    allowedRoles: STUDENT_ROLES,
    run: async (ctx, args) => {
      const kase = await resolveStudentCase(ctx.db, ctx.userId, {
        reference: (args["reference"] as string) ?? null,
        prefer: "decided",
      });
      if (!kase) return notFound(ctx.lang);
      const kind = (args["kind"] as ReviewKind) ?? "objection";
      const reason = String(args["reason"] ?? "").trim();
      if (!reason) {
        return {
          ok: false,
          error:
            ctx.lang === "ar"
              ? "أحتاج سببًا مختصرًا لتسجيل الاعتراض."
              : "I need a short reason before I can record this.",
        };
      }
      const res = await openCaseReview({
        db: ctx.db,
        kase,
        studentId: ctx.userId,
        kind,
        reason,
        requestedOutcome: (args["requested_outcome"] as string) ?? null,
        lang: ctx.lang,
      });
      const refreshed = await resolveStudentCase(ctx.db, ctx.userId, { reference: kase.case_number });
      const card = await buildCaseResultCard(ctx.db, refreshed ?? kase, ctx.lang);
      return { ok: true, data: { ...res, caseResultCard: card } };
    },
  },
];
