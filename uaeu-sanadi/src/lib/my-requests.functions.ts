import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RemovalResult = { requested: number; removed: number; skipped: number };

const caseInput = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  scope: z.enum(["selected", "all_resolved"]),
});

const suggestionInput = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  scope: z.enum(["selected", "all_suggestions"]),
});

function toResult(value: unknown): RemovalResult {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    requested: Number(v['requested'] ?? 0),
    removed: Number(v['removed'] ?? 0),
    skipped: Number(v['skipped'] ?? 0),
  };
}

/**
 * Hides eligible resolved/closed cases from the signed-in student's My Requests view.
 * Ownership and live eligibility are enforced inside the database function using
 * auth.uid(); ids sent by the browser only narrow the selection, they never widen it.
 */
export const removeMyRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => caseInput.parse(input))
  .handler(async ({ data, context }): Promise<RemovalResult> => {
    const { data: result, error } = await context.supabase.rpc(
      "remove_my_requests",
      data.scope === "selected"
        ? { _case_ids: data.ids ?? [], _scope: data.scope }
        : { _scope: data.scope },
    );
    if (error) throw new Error(error.message);
    return toResult(result);
  });

/** Hides eligible suggestions from the signed-in student's My Requests view. */
export const removeMySuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => suggestionInput.parse(input))
  .handler(async ({ data, context }): Promise<RemovalResult> => {
    const { data: result, error } = await context.supabase.rpc(
      "remove_my_suggestions",
      data.scope === "selected"
        ? { _suggestion_ids: data.ids ?? [], _scope: data.scope }
        : { _scope: data.scope },
    );
    if (error) throw new Error(error.message);
    return toResult(result);
  });
