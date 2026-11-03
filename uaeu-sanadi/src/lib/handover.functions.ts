/** Staff-only read of the handover package attached to a case. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type HandoverPackage = {
  caseNumber: string | null;
  studentName: string | null;
  studentNumber: string | null;
  studentEmail: string | null;
  unitEn: string | null;
  unitAr: string | null;
  interactionType: string | null;
  summary: string | null;
  conversation: { role: "student" | "sanadi"; text: string; at: string }[];
  verifiedData: Record<string, string | number | boolean | null>;
  actionsTaken: { what: string; reference: string | null; at: string | null }[];
  unresolvedIssue: string | null;
  recommendedAction: string | null;
  priority: string | null;
  attachments: { kind: string; label: string }[];
};

export const getCaseHandoverFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<HandoverPackage | null> => {
    // RLS already limits this table to staff who may access the case.
    const { data: row } = await context.supabase
      .from("case_handovers")
      .select("*")
      .eq("case_id", data.caseId)
      .maybeSingle();
    if (!row) return null;
    const { data: kase } = await context.supabase
      .from("cases")
      .select("case_number")
      .eq("id", data.caseId)
      .maybeSingle();
    return {
      caseNumber: kase?.case_number ?? null,
      studentName: row.student_name,
      studentNumber: row.student_number,
      studentEmail: row.student_email,
      unitEn: row.unit_name_en,
      unitAr: row.unit_name_ar,
      interactionType: row.interaction_type,
      summary: row.summary_en,
      conversation: (row.conversation_context ?? []) as HandoverPackage["conversation"],
      verifiedData: (row.verified_data ?? {}) as HandoverPackage["verifiedData"],
      actionsTaken: (row.actions_taken ?? []) as HandoverPackage["actionsTaken"],
      unresolvedIssue: row.unresolved_issue,
      recommendedAction: row.recommended_action,
      priority: row.priority,
      attachments: (row.attachments ?? []) as HandoverPackage["attachments"],
    };
  });
