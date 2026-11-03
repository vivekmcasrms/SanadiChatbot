/** Server functions for the unified interaction pipeline (chat + shortcuts). */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const interactionType = z.enum(["query", "complaint", "suggestion", "alert"]);
const urgency = z.enum(["low", "medium", "high", "critical"]);
const text = (max: number) => z.string().transform((v) => v.slice(0, max));

/** Live classification preview: shows the student where Sanadi will route this. */
export const previewInteractionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: text(200),
        description: text(8000),
        shortcutHint: interactionType.nullable().optional(),
        urgencyHint: urgency.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { previewInteraction } = await import("./interactions/intake.server");
    return previewInteraction({
      title: data.title,
      description: data.description,
      shortcutHint: data.shortcutHint ?? null,
      urgencyHint: data.urgencyHint ?? null,
    });
  });

/** The single submission endpoint used by every shortcut form. */
export const submitInteractionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(3).transform((v) => v.slice(0, 200)),
        description: z.string().min(10).transform((v) => v.slice(0, 8000)),
        shortcutHint: interactionType.nullable().optional(),
        urgencyHint: urgency.nullable().optional(),
        categoryId: z.string().uuid().nullable().optional(),
        unitId: z.string().uuid().nullable().optional(),
        desiredResolution: text(2000).nullable().optional(),
        expectedBenefit: text(2000).nullable().optional(),
        incidentDate: z.string().max(20).nullable().optional(),
        confidentiality: z.string().max(40).nullable().optional(),
        isAnonymous: z.boolean().optional(),
        location: text(200).nullable().optional(),
        conversationId: z.string().uuid().nullable().optional(),
        lang: z.enum(["en", "ar"]).default("en"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { submitInteraction } = await import("./interactions/intake.server");
    return submitInteraction({
      studentId: context.userId,
      lang: data.lang,
      title: data.title,
      description: data.description,
      shortcutHint: data.shortcutHint ?? null,
      channel: "shortcut",
      conversationId: data.conversationId ?? null,
      categoryId: data.categoryId ?? null,
      unitId: data.unitId ?? null,
      urgencyHint: data.urgencyHint ?? null,
      desiredResolution: data.desiredResolution ?? null,
      expectedBenefit: data.expectedBenefit ?? null,
      incidentDate: data.incidentDate ?? null,
      confidentiality: data.confidentiality ?? null,
      isAnonymous: data.isAnonymous ?? false,
      location: data.location ?? null,
    });
  });

/** Approved emergency pathways for the Alert shortcut. */
export const getEmergencyPathwaysFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lang: z.enum(["en", "ar"]).default("en") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { loadEmergencyContacts } = await import("./interactions/intake.server");
    return loadEmergencyContacts(data.lang);
  });

/** Query → Complaint conversion, keeping the original case and its history. */
export const convertQueryToComplaintFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), reason: text(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { escalateQueryToComplaint } = await import("./interactions/intake.server");
    return escalateQueryToComplaint({
      caseId: data.caseId,
      studentId: context.userId,
      reason: data.reason,
    });
  });
