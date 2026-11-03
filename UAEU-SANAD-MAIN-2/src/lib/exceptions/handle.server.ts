/**
 * Recovery runtime for the exception model.
 *
 * `withRecovery` is the one place that decides: try again, fall back to
 * verified cached data, or give the student a plain-language message. The
 * technical detail goes to `exception_events`; the student never sees it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EXCEPTIONS, exceptionFallback, exceptionMessage, type ExceptionCode } from "./catalogue";

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
};

/** Internal-only record. Never awaited on the hot path more than once. */
export async function logException(
  code: ExceptionCode,
  opts: ExceptionContext & { recovered?: boolean; recoveryAction?: string | null; escalated?: boolean } = {},
): Promise<string> {
  const traceId = opts.traceId ?? newTraceId();
  try {
    await supabaseAdmin.from("exception_events").insert({
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
