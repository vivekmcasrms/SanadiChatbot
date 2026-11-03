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
let currentToken: string | null = null;

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
  if (isUsable(currentToken)) return currentToken;
  currentToken = null;
  return fromStorage();
}
