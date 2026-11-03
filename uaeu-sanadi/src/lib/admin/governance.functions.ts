/**
 * University-wide governance reads for the Admin role.
 *
 * Everything is aggregated inside Postgres (`admin_governance_*` RPCs), which
 * also enforce authorisation: they raise unless the caller may monitor every
 * unit. Service Owners therefore cannot reach cross-unit performance data even
 * if they call these functions directly.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminOverview = {
  totals: {
    total: number;
    queries: number;
    complaints: number;
    suggestions: number;
    alerts: number;
    requests: number;
    open_new: number;
    in_progress: number;
    resolved: number;
    closed: number;
  };
  performance: {
    avg_resolution_hours: number | null;
    within_sla: number;
    approaching_sla: number;
    breached_sla: number;
    critical_alerts: number;
  };
  unitsNeedingAttention: {
    unit_id: string;
    name_en: string;
    name_ar: string;
    open_cases: number;
    breached: number;
    open_complaints: number;
    open_alerts: number;
  }[];
  recent: {
    id: string;
    caseNumber: string;
    title: string;
    type: string;
    status: string;
    unitEn: string | null;
    unitAr: string | null;
    at: string;
  }[];
};

export type OwnerPerformanceRow = {
  owner_id: string;
  owner_name: string;
  unit_en: string | null;
  unit_ar: string | null;
  assigned: number;
  open_cases: number;
  resolved: number;
  closed: number;
  complaints: number;
  overdue: number;
  avg_handling_hours: number | null;
  sla_compliance: number | null;
  resolution_rate: number | null;
};

export type GovernanceReport = {
  metrics: {
    total: number;
    queries: number;
    complaints: number;
    suggestions: number;
    alerts: number;
    requests: number;
    resolved: number;
    closed: number;
    unresolved: number;
    avg_resolution_hours: number | null;
    met_sla: number;
    breached_sla: number;
  };
  rows: {
    case_number: string;
    title: string;
    case_type: string;
    status: string;
    unit_en: string | null;
    unit_ar: string | null;
    owner_name: string | null;
    created_at: string;
    completed_at: string | null;
    resolution_due_at: string | null;
    resolution_hours: number | null;
  }[];
  byUnit: {
    unit_en: string;
    unit_ar: string;
    total: number;
    completed: number;
    open_cases: number;
    avg_resolution_hours: number | null;
  }[];
  byOwner: { owner_name: string; total: number; completed: number; open_cases: number }[];
};

/** Executive university-wide snapshot for the Admin dashboard. */
export const getAdminOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    const { data, error } = await context.supabase.rpc("admin_governance_overview");
    if (error) throw new Error(error.message);
    return data as unknown as AdminOverview;
  });

/** Operational performance per Service Owner across every unit. */
export const getOwnerPerformanceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerPerformanceRow[]> => {
    const { data, error } = await context.supabase.rpc("admin_owner_performance");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OwnerPerformanceRow[];
  });

const reportInput = z.object({
  from: z.string().min(1).nullish(),
  to: z.string().min(1).nullish(),
  unit: z.string().uuid().nullish(),
  owner: z.string().uuid().nullish(),
  type: z.string().max(30).nullish(),
  status: z.string().max(30).nullish(),
});

/** Report generator: filtered real records, never pre-computed statistics. */
export const getGovernanceReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<GovernanceReport> => {
    const args: Record<string, string> = {};
    if (data.from) args["_from"] = new Date(data.from).toISOString();
    if (data.to) args["_to"] = new Date(`${data.to}T23:59:59`).toISOString();
    if (data.unit) args["_unit"] = data.unit;
    if (data.owner) args["_owner"] = data.owner;
    if (data.type) args["_type"] = data.type;
    if (data.status) args["_status"] = data.status;

    const { data: result, error } = await context.supabase.rpc("admin_governance_report", args as never);
    if (error) throw new Error(error.message);
    return result as unknown as GovernanceReport;
  });
