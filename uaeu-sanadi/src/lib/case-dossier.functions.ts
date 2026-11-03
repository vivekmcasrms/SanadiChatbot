import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OWNER_STATUS = z.enum([
  "submitted",
  "ai_processing",
  "in_progress",
  "awaiting_student",
  "waiting_external",
  "placement_allocated",
  "resolved",
  "closed",
  "reopened",
  "escalated",
]);

const CONV_STATUS = z.enum(["active", "waiting_student", "waiting_staff", "resolved", "closed"]);

export const getCaseDossierFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.caseDossier(data.caseId, context.userId);
  });

export const addCaseNoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), body: z.string().trim().min(2).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.addInternalNote(data.caseId, context.userId, data.body);
  });

export const sendCaseMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), body: z.string().trim().min(2).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.sendStudentMessage(data.caseId, context.userId, data.body);
  });

export const setOwnerCaseStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ caseId: z.string().uuid(), status: OWNER_STATUS, note: z.string().max(2000).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.setOwnerCaseStatus(data.caseId, context.userId, data.status, data.note);
  });

export const ownerReopenCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), reason: z.string().trim().min(5).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.ownerReopenCase(data.caseId, context.userId, data.reason);
  });

export const setConversationStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid(), status: CONV_STATUS }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.setConversationStatus(data.caseId, context.userId, data.status);
  });

export const ownerChangePlacementFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        assignmentId: z.string().uuid(),
        newOpportunityId: z.string().uuid(),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-dossier.server");
    return ops.ownerChangePlacement(
      data.caseId,
      context.userId,
      data.assignmentId,
      data.newOpportunityId,
      data.reason,
    );
  });
