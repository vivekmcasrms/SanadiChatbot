/**
 * Recovery runtime for the exception model.
 *
 * `withRecovery` is the one place that decides: try again, fall back to
 * verified cached data, or give the student a plain-language message. The
 * technical detail goes to `exception_events`; the student never sees it.
 */
import { EXCEPTIONS, exceptionFallback, exceptionMessage, type ExceptionCode } from "./catalogue";
import { classifyError, DataUnavailableError, failure, ok, type Component, type ServiceResult } from "@/lib/result";

/** Short, non-guessable reference kept with the technical detail. */
export function newTraceId(): string {
  return `TR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export type ExceptionContext = {
  traceId?: string | null;
  /** The plain-language message the student actually saw, when there was one. */
  studentMessage?: string | null;
  /** True only for controlled admin tests, so real incidents stay separable. */
  isTest?: boolean;
  /** Name of the controlled scenario, for test events. */
  scenario?: string | null;
  userId?: string | null;
  caseId?: string | null;
  conversationId?: string | null;
  detail?: string | null;
  context?: Record<string, unknown>;
  /** Sanadi component where the failure happened (hostel, holds, rag, ...). */
  component?: string | null;
  /** Failure class: unavailable, forbidden, invalid, timeout, backend. */
  exceptionType?: string | null;
};

/** Internal-only record. Never awaited on the hot path more than once. */
export async function logException(
  code: ExceptionCode,
  opts: ExceptionContext & { recovered?: boolean; recoveryAction?: string | null; escalated?: boolean } = {},
): Promise<string> {
  const traceId = opts.traceId ?? newTraceId();
  try {
    // Loaded lazily so this module is safe to import from server-function files.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("exception_events").insert({
      component: opts.component ?? null,
      exception_type: opts.exceptionType ?? null,
      code,
      severity: EXCEPTIONS[code].severity,
      user_id: opts.userId ?? null,
      case_id: opts.caseId ?? null,
      conversation_id: opts.conversationId ?? null,
      detail: (opts.detail ?? "").slice(0, 2000) || null,
      context: (opts.context ?? {}) as never,
      recovered: opts.recovered ?? false,
      recovery_action: opts.recoveryAction ?? null,
      escalated: opts.escalated ?? false,
      trace_id: traceId,
      student_message: opts.studentMessage ?? null,
      resolved_at: opts.recovered ? new Date().toISOString() : null,
      is_test: opts.isTest ?? false,
      scenario: opts.scenario ?? null,
    });
    if (error) console.error("[exceptions] exception write rejected", code, traceId, error.code);
  } catch (err) {
    console.error("[exceptions] could not record exception", code, traceId, err);
  }
  return traceId;
}

export type RecoveryResult<T> =
  | { ok: true; value: T; recovered: boolean }
  | { ok: false; message: string; fallbackMessage: string; code: ExceptionCode; traceId: string };

/**
 * Run an operation with the recovery ladder of its exception type:
 * one retry → optional verified fallback → plain-language message.
 */
export async function withRecovery<T>(
  code: ExceptionCode,
  run: () => Promise<T>,
  opts: ExceptionContext & {
    lang?: "en" | "ar";
    /** Verified cached data used when the live attempt keeps failing. */
    fallback?: () => Promise<T | null>;
    retries?: number;
  } = {},
): Promise<RecoveryResult<T>> {
  const lang = opts.lang ?? "en";
  const traceId = opts.traceId ?? newTraceId();
  const attempts = Math.max(1, (opts.retries ?? 1) + 1);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await run();
      if (attempt > 0) {
        void logException(code, { ...opts, traceId, recovered: true, recoveryAction: "retry_succeeded" });
      }
      return { ok: true, value, recovered: attempt > 0 };
    } catch (err) {
      lastError = err;
    }
  }

  if (opts.fallback) {
    try {
      const value = await opts.fallback();
      if (value != null) {
        void logException(code, {
          ...opts,
          traceId,
          recovered: true,
          recoveryAction: "verified_fallback_used",
          detail: String(lastError),
        });
        return { ok: true, value, recovered: true };
      }
    } catch (err) {
      lastError = err;
    }
  }

  void logException(code, { ...opts, traceId, recovered: false, detail: String(lastError) });
  return {
    ok: false,
    code,
    traceId,
    message: exceptionMessage(code, lang),
    fallbackMessage: exceptionFallback(code, lang),
  };
}

// ---------------------------------------------------------------------------
// Component guards: one place that turns a thrown failure into a
// ServiceResult, records it, and keeps it from looking like "nothing found".
// ---------------------------------------------------------------------------

const COMPONENT_CODE: Record<Component, ExceptionCode> = {
  hostel: "api_failure",
  transfer: "api_failure",
  readiness: "missing_student_data",
  holds: "missing_student_data",
  case_lookup: "api_failure",
  staff_operations: "api_failure",
  notifications: "notification_failure",
  document_generation: "document_generation_failure",
  library: "api_failure",
  rag: "rag_failure",
  academic_progress: "missing_student_data",
  audit: "api_failure",
};

export type GuardOptions = Omit<ExceptionContext, "component" | "exceptionType"> & {
  lang?: "en" | "ar";
  /** What Sanadi does instead (shown in the Exceptions evidence). */
  recovery?: string;
};

/** Runs a service call; failures become a logged, nontechnical ServiceResult. */
export async function guardService<T>(component: Component, run: () => Promise<T>, opts: GuardOptions = {}): Promise<ServiceResult<T>> {
  try {
    return ok(await run());
  } catch (err) {
    return reportFailure<T>(component, err, opts);
  }
}

/** Records a failure (type, component, trace, recovery) and returns its result. */
export async function reportFailure<T>(component: Component, err: unknown, opts: GuardOptions = {}): Promise<ServiceResult<T>> {
  const lang = opts.lang ?? "en";
  const result = failure<T>(component, err, lang);
  const c = classifyError(err);
  const traceId = await logException(COMPONENT_CODE[component], {
    ...opts,
    component,
    exceptionType: c.type,
    studentMessage: result.user_message,
    recovered: false,
    recoveryAction: opts.recovery ?? "told_student_to_retry",
    // Internal detail only: error class and code, never a stack trace.
    detail: `${(err as Error)?.name ?? "Error"}: ${String((err as Error)?.message ?? err).slice(0, 300)}`,
  });
  console.error(`[${component}] ${result.internal_error_code} trace=${traceId}`);
  return result;
}

type InsertBuilder = { from: (t: "audit_logs") => { insert: (row: never) => PromiseLike<{ error: { code?: string; message?: string } | null }> } };

/**
 * Writes an audit row and checks the result. A failed write is retried once,
 * then recorded as an exception; the primary action is not rolled back.
 */
export async function auditInsert(db: unknown, row: Record<string, unknown>): Promise<boolean> {
  const client = db as InsertBuilder;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await client.from("audit_logs").insert(row as never);
      if (!error) {
        if (attempt > 0) void logException("api_failure", { component: "audit", exceptionType: "backend", recovered: true, recoveryAction: "audit_retry_succeeded", context: { action: row["action"] } });
        return true;
      }
      if (attempt === 1) {
        await logException("api_failure", { component: "audit", exceptionType: classifyError(error).type, recovered: false, recoveryAction: "audit_write_failed_action_kept", detail: `audit insert rejected: ${error.code ?? ""}`, context: { action: row["action"] } });
      }
    } catch (err) {
      if (attempt === 1) {
        await logException("api_failure", { component: "audit", exceptionType: classifyError(err).type, recovered: false, recoveryAction: "audit_write_failed_action_kept", detail: String((err as Error)?.message ?? err).slice(0, 300), context: { action: row["action"] } });
      }
    }
  }
  return false;
}

type MutationResult = { error: { code?: string; message?: string } | null };

/**
 * Checks a database mutation result. `strict` mutations (the primary change
 * of an action) throw so the caller reports failure instead of success;
 * secondary records (history, comments, events) are logged as exceptions.
 */
export async function checked<R extends MutationResult>(
  op: PromiseLike<R>,
  component: Component,
  table: string,
  strict = false,
): Promise<R> {
  const res = await op;
  if (res.error) {
    const c = classifyError(res.error);
    await logException(COMPONENT_CODE[component], {
      component,
      exceptionType: c.type,
      recovered: false,
      recoveryAction: strict ? "action_reported_as_failed" : "primary_action_kept_secondary_write_failed",
      detail: `${table} write rejected: ${res.error.code ?? ""}`,
      context: { table },
    });
    if (strict) throw new DataUnavailableError(component, res.error.code || "write_failed", c.status);
  }
  return res;
}
