import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DataAuditCount = { area: string; real: number; demo: number; unclassified: number };
export type DataAudit = {
  counts: DataAuditCount[];
  crossReferences: Record<string, number>;
  generatedAt: string;
};

/** Read-only real/demo classification report. Administrators only (checked in the database). */
export const getDataClassificationAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataAudit> => {
    const { data, error } = await context.supabase.rpc("admin_data_classification_audit");
    if (error) throw new Error(error.message);
    return data as unknown as DataAudit;
  });
