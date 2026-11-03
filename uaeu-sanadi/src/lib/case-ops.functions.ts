import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const acknowledgeCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid(), note: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.acknowledgeCase(data.caseId, context.userId, data.note);
  });

export const assignCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        assigneeId: z.string().uuid().nullable().optional(),
        note: z.string().max(2000).optional(),
        /** Optional one-tap reason from the staff UI; never required. */
        reasonCode: z.string().max(40).optional(),
        /** Assignee the staff member saw; a mismatch means the view is stale. */
        expectedAssignee: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.assignCase(
      data.caseId,
      context.userId,
      data.assigneeId ?? null,
      data.note,
      data.reasonCode ?? null,
      data.expectedAssignee,
    );
  });

export const changeCaseStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        status: z.enum([
          "acknowledged",
          "assigned",
          "in_review",
          "awaiting_student",
          "resolution_proposed",
          "escalated",
          "resolved",
          "closed",
        ]),
        note: z.string().max(2000).optional(),
        /** Required, in effect, for resolved/closed: what the student is told. */
        outcome: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.changeCaseStatus(data.caseId, context.userId, data.status, data.note, data.outcome);
  });

export const requestInformationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        informationRequired: z.string().trim().min(5).max(2000),
        reason: z.string().max(2000).optional(),
        dueInDays: z.number().int().min(1).max(60).optional(),
        pausesSla: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.requestInformation({ ...data, actorId: context.userId });
  });

export const provideInformationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        responseNote: z.string().trim().min(2).max(4000),
        requestId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    return ops.provideInformation({ ...data, studentId: context.userId });
  });

export const proposeResolutionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        summaryEn: z.string().trim().min(10).max(4000),
        summaryAr: z.string().max(4000).optional(),
        resolutionType: z.string().max(50).optional(),
        actionTaken: z.string().max(2000).optional(),
        policyBasis: z.string().max(2000).optional(),
        remedy: z.string().max(2000).optional(),
        managerApprovalRequired: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.proposeResolution({ ...data, actorId: context.userId });
  });

export const decideApprovalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        approvalId: z.string().uuid(),
        approve: z.boolean(),
        reason: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertManager(context.userId);
    return ops.decideApproval({ ...data, actorId: context.userId });
  });

export const respondToResolutionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        accept: z.boolean(),
        comment: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    return ops.respondToResolution({ ...data, studentId: context.userId });
  });

export const submitCaseFeedbackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        overall: z.number().int().min(1).max(5),
        speed: z.number().int().min(1).max(5).optional(),
        quality: z.number().int().min(1).max(5).optional(),
        communication: z.number().int().min(1).max(5).optional(),
        fairness: z.number().int().min(1).max(5).optional(),
        effort: z.number().int().min(1).max(5).optional(),
        fullyResolved: z.boolean().optional(),
        comments: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    return ops.submitCaseFeedback({ ...data, studentId: context.userId });
  });

export const requestReopenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        reason: z.string().trim().min(10).max(2000),
        newEvidence: z.string().max(2000).optional(),
        requestedOutcome: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    return ops.requestReopen({ ...data, studentId: context.userId });
  });

export const decideReopenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        reopenId: z.string().uuid(),
        approve: z.boolean(),
        reason: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertManager(context.userId);
    return ops.decideReopen({ ...data, actorId: context.userId });
  });

export const escalateCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), reason: z.string().trim().min(5).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    const { escalateCase } = await import("./ops/routing.server");
    return {
      ok: await escalateCase({
        caseId: data.caseId,
        reason: data.reason,
        triggerType: "manual",
        triggeredBy: context.userId,
      }),
    };
  });

export const routeCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    const { routeCase } = await import("./ops/routing.server");
    return routeCase(data.caseId);
  });

export const runScheduledJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        job: z.enum([
          "sla_sweep",
          "auto_escalation",
          "alert_generation",
          "info_request_reminders",
          "satisfaction_surveys",
          "all",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertManager(context.userId);
    const { runScheduledJob } = await import("./ops/jobs.server");
    return runScheduledJob(data.job);
  });
/**
 * Set Meeting Details — the standard case action. It updates the same case and
 * never creates a separate appointment record.
 */
export const setCaseMeetingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        meetingAt: z.string().min(10),
        mode: z.enum(["in_person", "online", "phone"]),
        location: z.string().max(400).optional(),
        note: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.setCaseMeeting({ ...data, actorId: context.userId });
  });

export const clearCaseMeetingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    return ops.clearCaseMeeting(data.caseId, context.userId);
  });
