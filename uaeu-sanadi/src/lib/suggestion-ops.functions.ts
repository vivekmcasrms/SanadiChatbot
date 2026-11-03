import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const id = z.string().uuid();

/** Called right after a student submits a suggestion: routes it and notifies the unit. */
export const intakeSuggestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ suggestionId: id }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const s = await ops.loadSuggestion(data.suggestionId);
    if (s.student_id !== context.userId) {
      const { assertStaff } = await import("./ops/case-actions.server");
      await assertStaff(context.userId);
    }
    return ops.intakeSuggestion(data.suggestionId);
  });

export const acknowledgeSuggestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ suggestionId: id, note: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    return ops.acknowledgeSuggestion(data.suggestionId, context.userId, data.note);
  });

export const assignSuggestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ suggestionId: id, assigneeId: id.nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    return ops.assignSuggestion(data.suggestionId, context.userId, data.assigneeId ?? null);
  });

export const assessSuggestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        suggestionId: id,
        impact: z.number().int().min(1).max(5),
        feasibility: z.number().int().min(1).max(5),
        alignment: z.number().int().min(1).max(5),
        costBand: z.string().max(40).nullable().optional(),
        complexity: z.string().max(40).nullable().optional(),
        recommendation: z.enum(["approve", "pilot", "defer", "decline"]),
        rationale: z.string().max(3000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    return ops.assessSuggestion({ ...data, actorId: context.userId });
  });

export const decideSuggestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        suggestionId: id,
        decision: z.enum(["planned", "implemented", "not_proceeding", "closed"]),
        outcomeEn: z.string().min(10).max(3000),
        outcomeAr: z.string().max(3000).nullable().optional(),
        targetDate: z.string().max(20).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    return ops.decideSuggestion({ ...data, actorId: context.userId });
  });

export const postSuggestionUpdateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        suggestionId: id,
        textEn: z.string().min(3).max(3000),
        textAr: z.string().max(3000).nullable().optional(),
        visibleToStudent: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/suggestion-actions.server");
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    return ops.postSuggestionUpdate({ ...data, actorId: context.userId });
  });
