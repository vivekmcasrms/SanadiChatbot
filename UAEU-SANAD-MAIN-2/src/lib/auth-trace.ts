/**
 * Structured client-side trace for the sign-in flow.
 *
 * Every step of `credentials -> provider -> session -> profile -> role ->
 * redirect` sends a best-effort diagnostic milestone without exposing tokens,
 * passwords or raw provider payloads in the browser console.
 */
import { apiUrl } from "@/lib/auth-token";

export type AuthTraceStep =
  | "AUTH_SUBMIT"
  | "AUTH_BROWSER_PROOF"
  | "AUTH_AUTHORIZE_REQUEST"
  | "AUTH_CALLBACK_RECEIVED"
  | "AUTH_TICKET_REQUEST"
  | "AUTH_SESSION_APPLIED"
  | "AUTH_REFRESH_REQUEST"
  | "AUTH_REFRESH_RESPONSE"
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
  stage?: string;
  [key: string]: unknown;
};

const FLOW_KEY = "sanadi-sso-trace";
const FLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let memoryFlowId: string | null = null;
const diagnosticCodes = new Set([
  "sso_start", "browser_proof_started", "browser_proof_ready", "authorize_requested",
  "sso_authorize_ok", "sso_provider", "sso_callback_received", "sso_callback_rejected",
  "sso_ticket_requested", "sso_ticket_redeemed", "sso_session_applied", "sso_start_failed",
  "home_after_sso_failure", "sso_login_no_session", "profile_found", "profile_missing",
  "session_check_started", "cookie_or_token_session_restored", "session_refreshed",
  "refresh_requested", "refresh_completed", "logout_complete", "logout_failed",
  "role_access_redirect", "role_content_mounted", "application_redirect",
  "student", "service_officer", "service_owner", "service_manager", "knowledge_manager",
  "knowledge_approver", "integration_admin", "system_admin", "auditor", "leadership_viewer",
  "unknown_error", "network_error", "rate_limited", "invalid_credentials", "email_not_confirmed",
  "unauthorized", "forbidden", "internal", "session_expired", "sso_unavailable", "sso_disabled",
  "sso_not_configured", "sso_expired", "sso_invalid_ticket", "sso_invalid_state", "sso_invalid_nonce",
  "sso_invalid_token", "sso_invalid_code", "sso_invalid_challenge", "sso_invalid_verifier",
]);
const diagnosticStages = new Set([
  "sso_start", "browser_proof", "authorize", "redirect", "callback", "sso_ticket",
  "session_install", "profile_roles", "refresh", "session_check", "logout",
]);

function diagnosticCode(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (diagnosticCodes.has(code) || /^http_[1-5][0-9]{2}$/.test(code)) return code;
  // Record navigation without copying query strings, tickets, or arbitrary URLs.
  return code.startsWith("/") ? "application_redirect" : "unclassified";
}

/** Correlation is diagnostic only; unavailable storage must not block a request. */
export function authTraceHeaders(): Record<string, string> {
  try {
    if (typeof window === "undefined") return {};
    const flowId = memoryFlowId ?? window.sessionStorage.getItem(FLOW_KEY);
    return flowId && FLOW_ID.test(flowId) ? { "X-Sanadi-Sso-Flow-Id": flowId.toLowerCase() } : {};
  } catch { return {}; }
}

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
  // Best-effort diagnostics must never block sign-in or include credentials.
  try {
    if (typeof window === "undefined") return;
    if (step === "AUTH_SUBMIT") {
      memoryFlowId = null;
      const flowId = crypto.randomUUID();
      try { window.sessionStorage.setItem(FLOW_KEY, flowId); }
      catch { memoryFlowId = flowId; /* Diagnostics can still report blocked storage. */ }
    }
    const flowId = authTraceHeaders()["X-Sanadi-Sso-Flow-Id"];
    if (!flowId) return;
    void fetch(apiUrl("/api/v1/auth/sso/trace"), {
      method: "POST", credentials: "omit", keepalive: true, referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step, code: diagnosticCode(detail.code), flowId,
        stage: detail.stage && diagnosticStages.has(detail.stage) ? detail.stage : undefined,
        ms: typeof detail.ms === "number" && Number.isFinite(detail.ms)
          ? Math.min(3_600_000, Math.max(0, Math.round(detail.ms))) : undefined,
      }),
    }).catch(() => { /* API unavailable: diagnostics remain best-effort. */ });
  } catch { /* Storage or networking must not interrupt sign-in. */ }
}

/** Small helper so callers can report elapsed time consistently. */
export function authTimer() {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  return () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
}
