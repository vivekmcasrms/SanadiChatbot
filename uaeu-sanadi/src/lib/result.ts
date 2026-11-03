/**
 * One result model for every service lookup and action.
 *
 * A real "nothing found" is `not_found`. A database/API failure is
 * `unavailable` and is NEVER reported to the student as "nothing found".
 * Student messages are plain language; technical detail stays internal.
 */
export type ResultStatus = "ok" | "not_found" | "unavailable" | "forbidden" | "invalid";

export type ServiceResult<T> = {
  status: ResultStatus;
  data: T | null;
  user_message: string | null;
  internal_error_code: string | null;
  retryable: boolean;
};

export type Component =
  | "hostel"
  | "transfer"
  | "readiness"
  | "holds"
  | "case_lookup"
  | "staff_operations"
  | "notifications"
  | "document_generation"
  | "library"
  | "rag"
  | "academic_progress"
  | "audit";

type Lang = "en" | "ar";

/** Thrown by `must()` so a failed query can never look like an empty one. */
export class DataUnavailableError extends Error {
  constructor(
    readonly component: Component,
    readonly code: string,
    readonly status: Exclude<ResultStatus, "ok" | "not_found"> = "unavailable",
  ) {
    super(`${component}: ${code}`);
    this.name = "DataUnavailableError";
  }
}

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Unwraps a database result; throws instead of returning empty data on failure. */
export function must<R extends QueryResult>(res: R, component: Component): NonNullable<R["data"]> | null {
  if (res.error) throw new DataUnavailableError(component, res.error.code || "db_error", statusFromCode(res.error.code, res.error.message));
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

export function statusFromCode(code?: string | null, message?: string | null): Exclude<ResultStatus, "ok" | "not_found"> {
  const c = String(code ?? "");
  const m = String(message ?? "").toLowerCase();
  if (c === "42501" || c === "PGRST301" || c === "401" || c === "403" || /permission denied|forbidden|not allowed|unauthori[sz]ed/.test(m)) return "forbidden";
  if (["22P02", "22023", "23502", "23514", "PGRST102", "400"].includes(c) || /invalid input|is required/.test(m)) return "invalid";
  return "unavailable";
}

/** Classifies any thrown value into a result status and internal code. */
export function classifyError(err: unknown): { status: Exclude<ResultStatus, "ok" | "not_found">; code: string; type: string } {
  if (err instanceof DataUnavailableError) return { status: err.status, code: err.code, type: err.status };
  const e = err as { code?: string; message?: string; name?: string } | null;
  const msg = String(e?.message ?? err ?? "");
  if (e?.name === "AbortError" || /timed? ?out|timeout|ETIMEDOUT|57014/i.test(msg) || e?.code === "57014") {
    return { status: "unavailable", code: "timeout", type: "timeout" };
  }
  const status = statusFromCode(e?.code, msg);
  return { status, code: e?.code || (status === "unavailable" ? "backend_error" : status), type: status === "unavailable" ? "backend" : status };
}

const SUBJECT: Record<Component, { en: string; ar: string }> = {
  hostel: { en: "your hostel information", ar: "بيانات السكن" },
  transfer: { en: "your programme transfer details", ar: "بيانات تحويل البرنامج" },
  readiness: { en: "your registration readiness", ar: "جاهزيتك للتسجيل" },
  holds: { en: "your hold status", ar: "حالة الإيقافات على حسابك" },
  case_lookup: { en: "that request", ar: "هذا الطلب" },
  staff_operations: { en: "that case action", ar: "إجراء الحالة" },
  notifications: { en: "your notifications", ar: "إشعاراتك" },
  document_generation: { en: "your document", ar: "مستندك" },
  library: { en: "the library catalogue", ar: "فهرس المكتبة" },
  rag: { en: "the university documents", ar: "المستندات الجامعية" },
  academic_progress: { en: "your academic progress", ar: "تقدمك الأكاديمي" },
  audit: { en: "that record", ar: "هذا السجل" },
};

/** Nontechnical message for a failure; never contains codes or stack traces. */
export function failureMessage(component: Component, status: ResultStatus, lang: Lang): string {
  const s = SUBJECT[component][lang];
  if (status === "forbidden") {
    return lang === "ar" ? `ليست لديك صلاحية للوصول إلى ${s}.` : `You don't have permission to access ${s}.`;
  }
  if (status === "invalid") {
    return lang === "ar" ? `لم أتمكن من فهم التفاصيل المطلوبة لـ${s}. هل يمكنك إعادة صياغتها؟` : `I couldn't use those details for ${s}. Could you rephrase them?`;
  }
  return lang === "ar"
    ? `تعذّر عليّ التحقق من ${s} الآن. يرجى المحاولة مرة أخرى بعد قليل.`
    : `I couldn't verify ${s} right now. Please try again.`;
}

export const ok = <T>(data: T): ServiceResult<T> => ({ status: "ok", data, user_message: null, internal_error_code: null, retryable: false });
export const notFound = <T>(message: string | null = null): ServiceResult<T> => ({ status: "not_found", data: null, user_message: message, internal_error_code: null, retryable: false });

export function failure<T>(component: Component, err: unknown, lang: Lang): ServiceResult<T> {
  const c = classifyError(err);
  return {
    status: c.status,
    data: null,
    user_message: failureMessage(component, c.status, lang),
    internal_error_code: `${component}.${c.code}`,
    retryable: c.status === "unavailable",
  };
}
