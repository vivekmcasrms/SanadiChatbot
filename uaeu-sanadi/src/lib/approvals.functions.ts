/**
 * Auditable student approvals.
 *
 * Every approval a student gives (or declines) is written as its own record:
 * who approved, which exact action, when, the data scope that was shown on the
 * card, and the result. Nothing here is a blanket consent — one record per
 * action, never reused for a later action.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  actionKey: z.string().min(1),
  status: z.enum(["approved", "declined", "completed", "failed"]),
  affectedService: z.string().nullish(),
  dataShared: z.string().nullish(),
  expectedOutcome: z.string().nullish(),
  responsibleUnit: z.string().nullish(),
  fee: z.string().nullish(),
  reversible: z.enum(["yes", "no", "conditional"]).nullish(),
  riskLevel: z.enum(["level_0", "level_1", "level_2", "level_3"]).default("level_2"),
  /** Field names only — never the values of the student's record. */
  dataScope: z.array(z.string()).default([]),
  receiptNumber: z.string().nullish(),
  approvalId: z.string().uuid().nullish(),
  language: z.enum(["en", "ar"]).default("en"),
});

export const recordApprovalDecisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string | null }> => {
    const payload = {
      responsible_unit: data.responsibleUnit ?? null,
      fee: data.fee ?? null,
      reversible: data.reversible ?? null,
      data_scope: data.dataScope,
      language: data.language,
      decided_at: new Date().toISOString(),
    };

    // A later result (completed / failed) updates the same approval record so
    // the trail reads: shown → decided → result.
    if (data.approvalId) {
      const { data: row } = await context.supabase
        .from("action_approvals")
        .update({
          status: data.status,
          receipt_number: data.receiptNumber ?? null,
          payload: payload as never,
        })
        .eq("id", data.approvalId)
        .eq("user_id", context.userId)
        .select("id")
        .maybeSingle();
      return { id: row?.id ?? data.approvalId };
    }

    const { data: row } = await context.supabase
      .from("action_approvals")
      .insert({
        user_id: context.userId,
        action_key: data.actionKey,
        status: data.status,
        risk_level: data.riskLevel,
        affected_service: data.affectedService ?? null,
        data_shared: data.dataShared ?? null,
        expected_outcome: data.expectedOutcome ?? null,
        receipt_number: data.receiptNumber ?? null,
        payload: payload as never,
      })
      .select("id")
      .maybeSingle();
    return { id: row?.id ?? null };
  });
