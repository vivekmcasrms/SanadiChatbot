/** Student-facing outcome view and the actions a student can take about it. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CaseOutcomeView } from "./ops/outcome-objection.server";

export type { CaseOutcomeView } from "./ops/outcome-objection.server";

export const getCaseOutcomeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CaseOutcomeView | null> => {
    const ops = await import("./ops/outcome-objection.server");
    try {
      return await ops.getCaseOutcome(data.caseId, context.userId);
    } catch {
      return null;
    }
  });

export const raiseOutcomeConcernFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        kind: z.enum(["question", "correction", "objection", "reopen"]),
        reason: z.string().trim().min(5).max(4000),
        lang: z.enum(["en", "ar"]).default("en"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/outcome-objection.server");
    return ops.raiseOutcomeConcern({
      caseId: data.caseId,
      studentId: context.userId,
      kind: data.kind,
      reason: data.reason,
      lang: data.lang,
    });
  });
