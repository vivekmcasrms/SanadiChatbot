/**
 * Structured client-side trace for the sign-in flow.
 *
 * Every step of `credentials -> provider -> session -> profile -> role ->
 * redirect` emits one console line with a duration and a safe error code, so a
 * stuck sign-in can be diagnosed from a screenshot of the browser console
 * without exposing tokens, passwords or raw provider payloads.
 */
export type AuthTraceStep =
  | "AUTH_SUBMIT"
  | "AUTH_PROVIDER_RESPONSE"
  | "AUTH_SESSION_CREATED"
  | "AUTH_PROFILE_LOADED"
  | "AUTH_ROLE_RESOLVED"
  | "AUTH_REDIRECT"
  | "AUTH_COMPLETE"
  | "AUTH_FAILED";

type TraceDetail = {
  /** Milliseconds since the sign-in attempt started. */
  ms?: number | undefined;
  /** Short, non-sensitive error/status code. */
  code?: string;
  [key: string]: unknown;
};

/** Derives a short, safe code from an unknown error without leaking details. */
export function safeAuthCode(error: unknown): string {
  if (!error) return "unknown_error";
  const anyErr = error as { code?: unknown; status?: unknown; message?: unknown };
  if (typeof anyErr.code === "string" && anyErr.code) return anyErr.code;
  if (typeof anyErr.status === "number") return `http_${anyErr.status}`;
  const message = typeof anyErr.message === "string" ? anyErr.message.toLowerCase() : "";
  if (/invalid login credentials/.test(message)) return "invalid_credentials";
  if (/email not confirmed/.test(message)) return "email_not_confirmed";
  if (/failed to fetch|network/.test(message)) return "network_error";
  if (/rate limit|too many/.test(message)) return "rate_limited";
  return "unknown_error";
}

export function authTrace(step: AuthTraceStep, detail: TraceDetail = {}) {
  if (typeof console === "undefined") return;
  const payload = { step, ...detail };
  if (step === "AUTH_FAILED") console.warn("[auth-trace]", payload);
  else console.info("[auth-trace]", payload);
}

/** Small helper so callers can report elapsed time consistently. */
export function authTimer() {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  return () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
}
