/**
 * Access token cache for server-function calls.
 *
 * `supabase.auth.getSession()` acquires an internal lock. When it is called
 * while the auth client is busy (initial hydration, a token refresh, or an
 * `onAuthStateChange` callback), it can resolve with `null` even though the
 * user is signed in — which made server functions fire without an
 * Authorization header and fail with "Unauthorized: No authorization header
 * provided". Keeping the current token in memory (and falling back to the
 * persisted session) removes that race.
 *
 * Cached tokens expire, so every read validates the JWT `exp` claim. A stale
 * token would otherwise be sent and rejected with "Unauthorized: Invalid token".
 */
import { isSignedOut } from "@/lib/logout-state";

let currentToken: string | null = null;
const TOKEN_STORAGE_KEY = "sanadi-api-access-token";
const API_BASE_URL = import.meta.env["VITE_API_BASE_URL"];

/** Resolve an API path against the configured Sanadi API host. */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) throw new Error("API paths must start with '/'");
  return `${API_BASE_URL}${path}`;
}

/** Treat a token as unusable slightly before it actually expires. */
const SKEW_MS = 30_000;

function decodeExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isUsable(token: string | null): token is string {
  if (!token) return false;
  const exp = decodeExp(token);
  if (exp === null) return false;
  return exp - SKEW_MS > Date.now();
}

export function setAuthToken(token: string | null) {
  currentToken = token;
  if (typeof window !== "undefined") {
    if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function fromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed?.access_token && isUsable(parsed.access_token)) {
        return parsed.access_token;
      }
    }
  } catch {
    /* storage unavailable or malformed — fall through */
  }
  return null;
}

/** Returns a non-expired access token, or null when a refresh is required. */
export function getAuthToken(): string | null {
  if (isSignedOut()) return null;
  if (isUsable(currentToken)) return currentToken;
  if (typeof window !== "undefined") {
    const stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (isUsable(stored)) {
      currentToken = stored;
      return stored;
    }
  }
  currentToken = null;
  return null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers ?? {});

  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData) && !(init.body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });

  const text = await response.text();
  // Protected requests after session loss must leave stale role content. Auth
  // endpoints handle refresh themselves; 403 never means session expiration.
  if (response.status === 401 && !path.startsWith("/api/v1/auth/") &&
      typeof window !== "undefined" && window.location.pathname !== "/auth" &&
      window.location.pathname !== "/auth/callback") {
    setAuthToken(null);
    window.sessionStorage.removeItem("sanadi-api-refresh-token");
    window.sessionStorage.setItem("sanadi-force-sso", "1");
    window.dispatchEvent(new Event("sanadi-signing-out"));
    window.location.replace("/auth");
  }
  if (!response.ok) {
    let message = "Request failed";
    let code: string | undefined;
    if (text) {
      try {
        const payload = JSON.parse(text) as {
          code?: unknown;
          message?: unknown;
          error?: unknown;
          title?: unknown;
          msg?: unknown;
        };
        if (typeof payload.code === "string") code = payload.code;
        const pick = (v: unknown): string | null => {
          if (typeof v === "string" && v.trim()) return v;
          if (v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string") {
            return (v as { message: string }).message;
          }
          return null;
        };
        message =
          pick(payload.message) ??
          pick(payload.error) ??
          pick(payload.msg) ??
          pick(payload.title) ??
          message;
      } catch {
        message = text;
      }
    }
    throw Object.assign(new Error(typeof message === "string" ? message : "Request failed"), {
      code, status: response.status,
    });
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
