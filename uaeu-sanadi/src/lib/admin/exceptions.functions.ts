/**
 * Admin view of the recovery log: which predictable failures happened, what
 * Sanadi did about them, and whether a person had to step in.
 *
 * Students never see any of this. Each entry carries the trace reference that
 * support uses to find the technical detail in the server logs.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  EXCEPTIONS,
  EXCEPTION_LABELS,
  isExceptionCode,
  type ExceptionCode,
} from "@/lib/exceptions/catalogue";

export type ExceptionRow = {
  id: string;
  code: ExceptionCode | string;
  label: { en: string; ar: string };
  severity: string;
  recovered: boolean;
  escalated: boolean;
  recoveryAction: string | null;
  traceId: string | null;
  caseId: string | null;
  createdAt: string;
};

export type ExceptionSummary = {
  code: string;
  label: { en: string; ar: string };
  total: number;
  recovered: number;
  escalated: number;
};

export type ExceptionLogResult = {
  rows: ExceptionRow[];
  summary: ExceptionSummary[];
  windowDays: number;
};

async function assertOversight(context: {
  supabase: { rpc: (fn: "can_monitor_all_units", args: { _user_id: string }) => PromiseLike<{ data: unknown }> };
  userId: string;
}) {
  const { data } = await context.supabase.rpc("can_monitor_all_units", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden");
}

const label = (code: string) =>
  isExceptionCode(code) ? EXCEPTION_LABELS[code] : { en: code.replace(/_/g, " "), ar: code.replace(/_/g, " ") };

/** Recent recovery events, newest first, with a per-type summary. */
export const listExceptionEventsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ days: z.number().min(1).max(90).default(14) }).parse(d ?? {}))
  .handler(async ({ context, data }): Promise<ExceptionLogResult> => {
    await assertOversight(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: events } = await supabaseAdmin
      .from("exception_events")
      .select("id, code, severity, recovered, escalated, recovery_action, trace_id, case_id, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    const rows: ExceptionRow[] = (events ?? []).map((e) => ({
      id: e.id,
      code: e.code,
      label: label(e.code),
      severity: e.severity ?? (isExceptionCode(e.code) ? EXCEPTIONS[e.code].severity : "warning"),
      recovered: Boolean(e.recovered),
      escalated: Boolean(e.escalated),
      recoveryAction: e.recovery_action ?? null,
      traceId: (e as { trace_id?: string | null }).trace_id ?? null,
      caseId: e.case_id ?? null,
      createdAt: e.created_at,
    }));

    const byCode = new Map<string, ExceptionSummary>();
    for (const row of rows) {
      const entry = byCode.get(row.code) ?? { code: row.code, label: row.label, total: 0, recovered: 0, escalated: 0 };
      entry.total += 1;
      if (row.recovered) entry.recovered += 1;
      if (row.escalated) entry.escalated += 1;
      byCode.set(row.code, entry);
    }

    return {
      rows,
      summary: [...byCode.values()].sort((a, b) => b.total - a.total),
      windowDays: data.days,
    };
  });

/* ------------------------------------------------------------------ */
/* Exception evidence + controlled tests                               */
/* ------------------------------------------------------------------ */

export type ExceptionTestRow = {
  id: string;
  scenario: string;
  label: { en: string; ar: string };
  code: string;
  recovered: boolean;
  escalated: boolean;
  recoveryAction: string | null;
  studentMessage: string | null;
  traceId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type ExceptionEvidence = {
  detected: number;
  recovered: number;
  escalated: number;
  recoveryRate: number;
  realIncidents: number;
  controlledTests: number;
  latestTests: ExceptionTestRow[];
  byCode: ExceptionSummary[];
};

/**
 * Evidence for the Exceptions criterion: how many failures were detected, how
 * many recovered, and the latest controlled tests with their pass/fail state.
 * Nothing is hard-coded — every number is read from recorded events.
 */
export const getExceptionEvidenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExceptionEvidence> => {
    await assertOversight(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SCENARIO_LABELS } = await import("@/lib/exceptions/scenarios.server");
    const { data: events } = await supabaseAdmin
      .from("exception_events")
      .select(
        "id, code, recovered, escalated, recovery_action, trace_id, created_at, resolved_at, student_message, is_test, scenario",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = (events ?? []) as Array<{
      id: string;
      code: string;
      recovered: boolean | null;
      escalated: boolean | null;
      recovery_action: string | null;
      trace_id: string | null;
      created_at: string;
      resolved_at: string | null;
      student_message: string | null;
      is_test: boolean | null;
      scenario: string | null;
    }>;

    const detected = rows.length;
    const recovered = rows.filter((r) => r.recovered).length;
    const escalated = rows.filter((r) => r.escalated).length;
    const controlledTests = rows.filter((r) => r.is_test).length;

    const byCode = new Map<string, ExceptionSummary>();
    for (const r of rows) {
      const entry = byCode.get(r.code) ?? { code: r.code, label: label(r.code), total: 0, recovered: 0, escalated: 0 };
      entry.total += 1;
      if (r.recovered) entry.recovered += 1;
      if (r.escalated) entry.escalated += 1;
      byCode.set(r.code, entry);
    }

    const labels = SCENARIO_LABELS as Record<string, { en: string; ar: string }>;
    const latestTests: ExceptionTestRow[] = rows
      .filter((r) => r.is_test)
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        scenario: r.scenario ?? r.code,
        label: (r.scenario && labels[r.scenario]) || label(r.code),
        code: r.code,
        recovered: Boolean(r.recovered),
        escalated: Boolean(r.escalated),
        recoveryAction: r.recovery_action,
        studentMessage: r.student_message,
        traceId: r.trace_id,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      }));

    return {
      detected,
      recovered,
      escalated,
      recoveryRate: detected ? Math.round((recovered / detected) * 100) : 0,
      realIncidents: detected - controlledTests,
      controlledTests,
      latestTests,
      byCode: [...byCode.values()].sort((a, b) => b.total - a.total),
    };
  });

/**
 * Runs one controlled exception scenario against the real detection and
 * recovery code. Safe: it never writes to cases, students, staff or documents.
 */
export const runExceptionTestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        scenario: z.enum(["ambiguous_request", "api_timeout", "staff_unavailable", "missing_knowledge", "db_timeout", "rag_unavailable", "library_unavailable", "hostel_transaction_failure", "transfer_data_failure", "notification_write_failure"]),
        language: z.enum(["en", "ar"]).default("en"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertOversight(context);
    const { runExceptionScenario } = await import("@/lib/exceptions/scenarios.server");
    return runExceptionScenario(context.supabase as never, data.scenario, context.userId, data.language);
  });
