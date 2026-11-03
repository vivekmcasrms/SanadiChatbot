import { apiFetch, apiUrl, setAuthToken } from "@/lib/auth-token";
import type { ApiSession } from "@/lib/api-auth";
import { authTrace, authTraceHeaders, authTimer, safeAuthCode } from "@/lib/auth-trace";
import { clearSignedOut, isSignedOut, logoutGeneration } from "@/lib/logout-state";

export const SSO_INITIATION_PATH = "/api/v1/auth/sso/initiatesso";

/** The browser navigates to the API; the frontend never constructs the provider URL. */
export function ssoInitiationUrl(): string {
  return apiUrl(SSO_INITIATION_PATH);
}

const VERIFIER_KEY = "sanadi-sso-verifier";
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let starting: Promise<void> | null = null;

export function startSsoLogin(): Promise<void> {
  if (starting) return starting;
  let stage = "sso_start";
  const elapsed = authTimer();
  starting = (async () => {
    const generation = logoutGeneration();
    authTrace("AUTH_SUBMIT", { code: "sso_start" });
    stage = "browser_proof";
    authTrace("AUTH_BROWSER_PROOF", { code: "browser_proof_started", stage, ms: elapsed() });
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
    window.sessionStorage.setItem("sanadi-sso-generation", generation ?? "");
    authTrace("AUTH_BROWSER_PROOF", { code: "browser_proof_ready", stage, ms: elapsed() });
    stage = "authorize";
    authTrace("AUTH_AUTHORIZE_REQUEST", { code: "authorize_requested", stage, ms: elapsed() });
    const response = await apiFetch<{ authorizationUrl: string }>(
      `/api/v1/auth/sso/authorize?challenge=${base64Url(new Uint8Array(digest))}`,
      { cache: "no-store", headers: authTraceHeaders() },
    );
    const target = new URL(response.authorizationUrl);
    if (generation !== logoutGeneration()) throw new Error("Sign-in cancelled by logout");
    authTrace("AUTH_PROVIDER_RESPONSE", { code: "sso_authorize_ok" });
    stage = "redirect";
    if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)))
      throw new Error("Invalid SSO authorization URL");
    authTrace("AUTH_REDIRECT", { code: "sso_provider" });
    window.location.assign(target.href);
  })().catch(error => {
    authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage, ms: elapsed() });
    throw error;
  }).finally(() => { starting = null; });
  return starting;
}

export async function redeemSsoTicket(ticket: string): Promise<ApiSession> {
  const generation = logoutGeneration();
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);
  if (isSignedOut() && (!verifier || window.sessionStorage.getItem("sanadi-sso-generation") !== (generation ?? "")))
    throw new Error("Start a new sign-in after logout");
  try {
    authTrace("AUTH_TICKET_REQUEST", { code: "sso_ticket_requested", stage: "sso_ticket" });
    const session = await apiFetch<ApiSession>("/api/v1/auth/sso/session", {
      method: "POST", cache: "no-store",
      headers: authTraceHeaders(),
      body: JSON.stringify({ ticket, verifier }),
    });
    if (!session.access_token || !session.refresh_token || !session.user?.id)
      throw new Error("Invalid SSO session response");
    if (generation !== logoutGeneration()) throw new Error("Sign-in cancelled by logout");
    clearSignedOut();
    setAuthToken(session.access_token);
    window.sessionStorage.setItem("sanadi-api-refresh-token", session.refresh_token);
    authTrace("AUTH_SESSION_CREATED", { code: "sso_ticket_redeemed" });
    return session;
  } finally {
    if (window.sessionStorage.getItem(VERIFIER_KEY) === verifier) {
      window.sessionStorage.removeItem(VERIFIER_KEY);
      window.sessionStorage.removeItem("sanadi-sso-generation");
    }
  }
}
