/**
 * Admin case monitoring & SLA oversight.
 *
 * Everything here is read-first: the database does the filtering, ranking,
 * aggregation and paging (see `admin_case_monitor*` RPCs), so the browser only
 * ever receives one page of rows plus pre-computed counts — the page costs the
 * same with 200 cases or 200,000.
 *
 * Authorisation is enforced twice: the RPCs raise unless
 * `can_monitor_cases(auth.uid())` is true, and they narrow every query to the
 * caller's monitoring scope (all units only with the explicit
 * "monitor all units" grant, otherwise the units the user owns).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clampPage, clampPageSize, pageResult, type PageResult } from "@/lib/list-query";

export type MonitorActor =
  | "ai"
  | "student"
  | "service_owner"
  | "specific_officer"
  | "external_party"
  | "manager"
  | "staff"
  | "system";

export type MonitorSlaStatus = "on_track" | "attention" | "critical" | "breached" | "paused" | "completed";

export type MonitorRow = {
  id: string;
  case_number: string;
  case_type: string;
  title: string;
  status: string;
  urgency: string | null;
  severity: string | null;
  service_unit_id: string | null;
  unit_name_en: string | null;
  unit_name_ar: string | null;
  assigned_to: string | null;
  owner_name: string | null;
  student_id: string | null;
  student_name: string | null;
  student_number: string | null;
  routing_service_code: string | null;
  routing_topic: string | null;
  root_cause_code: string | null;
  actor: MonitorActor | string;
  responsible_since: string;
  created_at: string;
  last_activity_at: string | null;
  sla_due_at: string | null;
  sla_status: MonitorSlaStatus;
  sla_paused: boolean;
  breach_seconds: number;
  owner_response_due_at: string | null;
  response_overdue: boolean;
  response_state: string | null;
  waiting_seconds: number;
  inactive_seconds: number;
  stalled: boolean;
  closure_incomplete: boolean;
  critical_alert: boolean;
  escalation_unresolved: boolean;
  escalation_level: number | null;
  escalated_at: string | null;
  acknowledged_at: string | null;
  reopened_count: number | null;
  is_sensitive: boolean | null;
  is_closed: boolean;
  resolved_at: string | null;
  resolution_communicated_at: string | null;
  next_action_en: string | null;
  next_action_ar: string | null;
  risk_rank: number;
};

export type MonitorSummary = {
  active: number;
  pendingOwner: number;
  responseOverdue: number;
  attention: number;
  critical: number;
  breached: number;
  paused: number;
  escalated: number;
  waitingStudent: number;
  waitingExternal: number;
  aiHandling: number;
  criticalAlerts: number;
  stalled: number;
  closureIncomplete: number;
  openComplaints: number;
  openSuggestions: number;
  reopened: number;
  todayHandled: number;
  todayResolved: number;
};

export type UnitMonitorRow = {
  unitId: string | null;
  unitEn: string;
  unitAr: string;
  active: number;
  ownerPending: number;
  studentPending: number;
  externalPending: number;
  attention: number;
  critical: number;
  breached: number;
  criticalAlerts: number;
  responseOverdue: number;
  automationRate: number;
  medianResolutionHours: number | null;
};

export type OwnerMonitorRow = {
  ownerId: string;
  ownerName: string;
  unitEn: string;
  unitAr: string;
  activeCases: number;
  overdueResponses: number;
  breached: number;
  unresolvedEscalations: number;
  closedCases: number;
  /** Share of completed cases resolved within SLA (0–1), or null when nothing is completed yet. */
  slaCompliance: number | null;
  medianResponseHours: number | null;
};

const monitorInput = z.object({
  search: z.string().max(120).optional(),
  unit: z.string().uuid().nullish(),
  type: z.string().max(20).optional(),
  status: z.string().max(30).optional(),
  sla: z.string().max(20).optional(),
  actor: z.string().max(30).optional(),
  escalation: z.string().max(20).optional(),
  priority: z.string().max(20).optional(),
  owner: z.string().uuid().nullish(),
  view: z.string().max(20).catch("open"),
  range: z.string().max(10).optional(),
  sort: z.string().max(20).catch("risk"),
  page: z.number().int().min(1).max(10_000).catch(1),
  pageSize: z.number().int().min(5).max(100).catch(25),
});

function sinceIso(range: string | undefined): string | undefined {
  const now = Date.now();
  switch (range) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "7d":
      return new Date(now - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now - 30 * 86_400_000).toISOString();
    case "90d":
      return new Date(now - 90 * 86_400_000).toISOString();
    default:
      return undefined;
  }
}

const orAll = (v: string | undefined | null) => (!v || v === "all" ? undefined : v);

/** Can the signed-in user open the monitoring workspace, and over which scope? */
export const getMonitorAccessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ canMonitor: boolean; allUnits: boolean }> => {
    const db = context.supabase;
    const [{ data: canMonitor }, { data: allUnits }] = await Promise.all([
      db.rpc("can_monitor_cases", { _user_id: context.userId }),
      db.rpc("can_monitor_all_units", { _user_id: context.userId }),
    ]);
    return { canMonitor: Boolean(canMonitor), allUnits: Boolean(allUnits) };
  });

/** One page of the monitoring table — filtered, risk-ranked and sliced in Postgres. */
export const listMonitoredCasesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => monitorInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<MonitorRow>> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize, 25);

    // exactOptionalPropertyTypes: only send keys that actually carry a value.
    const args: Record<string, string | number> = {
      _view: data.view || "open",
      _sort: data.sort || "risk",
      _page: page,
      _page_size: pageSize,
    };
    const optional: Record<string, string | undefined> = {
      _search: data.search?.trim() || undefined,
      _unit: data.unit ?? undefined,
      _type: orAll(data.type),
      _status: orAll(data.status),
      _sla: orAll(data.sla),
      _actor: orAll(data.actor),
      _escalation: orAll(data.escalation),
      _priority: orAll(data.priority),
      _owner: data.owner ?? undefined,
      _since: sinceIso(data.range),
    };
    for (const [k, v] of Object.entries(optional)) if (v !== undefined) args[k] = v;

    const { data: result, error } = await context.supabase.rpc(
      "admin_case_monitor",
      args as never,
    );


    if (error) throw new Error(error.message);

    const payload = (result ?? {}) as { items?: MonitorRow[]; total?: number };
    return pageResult(payload.items ?? [], payload.total ?? 0, page, pageSize);
  });

/** Operational summary counters — aggregated in the database, never in React. */
export const getMonitorSummaryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MonitorSummary> => {
    const { data, error } = await context.supabase.rpc("admin_case_monitor_summary");
    if (error) throw new Error(error.message);
    return data as unknown as MonitorSummary;
  });

export const getUnitMonitorFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UnitMonitorRow[]> => {
    const { data, error } = await context.supabase.rpc("admin_unit_monitor");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UnitMonitorRow[];
  });

export const getOwnerMonitorFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerMonitorRow[]> => {
    const { data, error } = await context.supabase.rpc("admin_owner_monitor");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OwnerMonitorRow[];
  });

export type MonitorDetail = {
  case: MonitorRow;
  responsibility: {
    actor: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    unitId: string | null;
    reason: string | null;
  }[];
  statusHistory: { from: string | null; to: string; note: string | null; at: string }[];
  slaEvents: {
    type: string;
    threshold: number | null;
    at: string;
    acknowledgedAt: string | null;
    action: string | null;
  }[];
  escalations: {
    level: number | null;
    reason: string | null;
    at: string;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
  }[];
  oversight: { type: string; reason: string | null; at: string }[];
};

/** Full oversight dossier for one case (opened from the monitoring table). */
export const getMonitoredCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<MonitorDetail> => {
    const { data: detail, error } = await context.supabase.rpc("admin_case_monitor_detail", {
      _case_id: data.caseId,
    });
    if (error) throw new Error(error.message);
    return detail as unknown as MonitorDetail;
  });

const oversightInput = z.object({
  caseId: z.string().uuid(),
  action: z.enum(["remind_owner", "escalate", "reassign", "note"]),
  reason: z.string().max(1000).optional(),
  newUnitId: z.string().uuid().nullish(),
  newOwnerId: z.string().uuid().nullish(),
});

/**
 * The only write path admins get. Oversight nudges the responsible owner or
 * moves a case; it never resolves the case on the owner's behalf.
 */
export const recordOversightActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => oversightInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string }> => {
    const db = context.supabase;
    const { data: canMonitor } = await db.rpc("can_monitor_cases", { _user_id: context.userId });
    if (!canMonitor) throw new Error("Not authorised for case oversight");

    const { performOversightAction } = await import("@/lib/monitoring/oversight.server");
    return performOversightAction({
      caseId: data.caseId,
      actorId: context.userId,
      action: data.action,
      reason: data.reason ?? null,
      newUnitId: data.newUnitId ?? null,
      newOwnerId: data.newOwnerId ?? null,
    });
  });

/** Marks the closure loop complete once the student has actually been told. */
export const markResolutionCommunicatedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { data: canMonitor } = await context.supabase.rpc("can_monitor_cases", {
      _user_id: context.userId,
    });
    if (!canMonitor) throw new Error("Not authorised for case oversight");
    const { confirmResolutionCommunicated } = await import("@/lib/monitoring/oversight.server");
    await confirmResolutionCommunicated(data.caseId, context.userId);
    return { ok: true };
  });
