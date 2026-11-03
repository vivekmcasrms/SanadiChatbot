import { apiFetch, apiUrl, getAuthToken, setAuthToken } from "@/lib/auth-token";
import { clearSignedOut, isSignedOut, logoutGeneration, markSignedOut } from "@/lib/logout-state";
import { authTrace, authTraceHeaders, safeAuthCode } from "@/lib/auth-trace";

export type ApiUser = {
  id: string;
  email: string | null;
  user_metadata?: { full_name?: string | null; preferred_language?: "en" | "ar" };
  app_metadata?: { roles?: string[] };
};

export type ApiSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: ApiUser;
};

type AuthResponse = ApiSession;

export async function apiSignIn(email: string, password: string): Promise<ApiSession> {
  const generation = logoutGeneration();
  const session = await apiFetch<AuthResponse>("/api/v1/auth/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (generation !== logoutGeneration()) throw new Error("Sign-in cancelled by logout");
  if (typeof window !== "undefined") clearSignedOut();
  setAuthToken(session.access_token);
  if (typeof window !== "undefined") window.sessionStorage.setItem("sanadi-api-refresh-token", session.refresh_token);
  return session;
}

export async function apiSignUp(email: string, password: string, fullName: string): Promise<ApiSession> {
  const generation = logoutGeneration();
  const session = await apiFetch<AuthResponse>("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
  });
  if (generation !== logoutGeneration()) throw new Error("Sign-in cancelled by logout");
  if (typeof window !== "undefined") clearSignedOut();
  setAuthToken(session.access_token);
  if (typeof window !== "undefined") window.sessionStorage.setItem("sanadi-api-refresh-token", session.refresh_token);
  return session;
}

export async function apiRefresh(): Promise<ApiSession | null> {
  if (typeof window === "undefined") return null;
  if (isSignedOut()) return null;
  const generation = logoutGeneration();
  const refreshToken = window.sessionStorage.getItem("sanadi-api-refresh-token");
  try {
    authTrace("AUTH_REFRESH_REQUEST", { code: "refresh_requested", stage: "refresh" });
    const session = await apiFetch<AuthResponse>("/api/v1/auth/token?grant_type=refresh_token", {
      method: "POST",
      headers: authTraceHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken || null }),
    });
    if (isSignedOut() || generation !== logoutGeneration()) return null;
    setAuthToken(session.access_token);
    window.sessionStorage.setItem("sanadi-api-refresh-token", session.refresh_token);
    authTrace("AUTH_REFRESH_RESPONSE", { code: "refresh_completed", stage: "refresh" });
    return session;
  } catch (error) {
    // A failed refresh is not an explicit logout. Never revoke a potentially
    // valid server session because a request or network connection failed.
    if (error instanceof Error && "status" in error && error.status === 401) {
      setAuthToken(null);
      window.sessionStorage.removeItem("sanadi-api-refresh-token");
    }
    authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage: "refresh" });
    if (error instanceof Error && (("code" in error && error.code === "session_expired") ||
        (refreshToken && "status" in error && error.status === 401))) {
      window.sessionStorage.setItem("sanadi-force-sso", "1");
      window.location.assign("/auth");
    }
    return null;
  }
}

export async function apiCurrentUser(): Promise<ApiUser | null> {
  if (isSignedOut()) return null;
  const generation = logoutGeneration();
  authTrace("AUTH_PROVIDER_RESPONSE", { code: "session_check_started" });
  try {
    const user = await apiFetch<ApiUser>("/api/v1/auth/user", { headers: authTraceHeaders() });
    if (isSignedOut() || generation !== logoutGeneration()) return null;
    authTrace("AUTH_SESSION_CREATED", { code: "cookie_or_token_session_restored" });
    return user;
  } catch (error) {
    authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage: "session_check" });
    if (!(error instanceof Error) || !("status" in error) || error.status !== 401) return null;
    const refreshed = await apiRefresh();
    if (refreshed) authTrace("AUTH_SESSION_CREATED", { code: "session_refreshed" });
    return refreshed?.user ?? null;
  }
}

export async function apiSignOut(redirectToSso = false) {
  const accessToken = getAuthToken();
  const refreshToken = typeof window === "undefined" ? null : window.sessionStorage.getItem("sanadi-api-refresh-token");
  if (typeof window !== "undefined") {
    markSignedOut();
    window.sessionStorage.removeItem("sanadi-api-refresh-token");
  }
  setAuthToken(null);
  if (redirectToSso) window.dispatchEvent(new Event("sanadi-signing-out"));
  try {
    // Await cookie deletion before starting the next authentication request.
    const response = await fetch(apiUrl("/api/v1/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ refresh_token: refreshToken }),
      credentials: "include",
      keepalive: true,
      signal: AbortSignal.timeout(10000),
    });
    authTrace(response.ok ? "AUTH_COMPLETE" : "AUTH_FAILED", { code: response.ok ? "logout_complete" : "logout_failed" });
  } catch (error) {
    authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage: "logout" });
  } finally {
    setAuthToken(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("sanadi-api-refresh-token");
      if (redirectToSso) {
        window.sessionStorage.setItem("sanadi-force-sso", "1");
        // Use the same fresh SSO sign-in flow as session expiry after cleanup.
        window.location.replace("/auth");
      }
    }
  }
}
