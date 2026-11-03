import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getAuthToken, setAuthToken } from "@/lib/auth-token";

/**
 * Project-specific replacement for the generated `attachSupabaseAuth`.
 * Prefers the in-memory/persisted token so a busy auth lock can never strip
 * the bearer header. Expired cached tokens are discarded and refreshed through
 * `getSession()` (which renews when needed) so the server never receives a
 * stale token ("Unauthorized: Invalid token").
 */
export const attachAuthToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = await resolveAuthToken();
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});

/**
 * Resolves a usable access token, tolerating the brief window right after page
 * load where the Supabase client is still hydrating its persisted session.
 * Without the retry, queries that fire on mount reach the server with no
 * Authorization header and fail with "Unauthorized: No authorization header
 * provided".
 */
async function resolveAuthToken(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cached = getAuthToken();
    if (cached) return cached;

    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token ?? null;
    if (!token) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      token = refreshed.session?.access_token ?? null;
    }
    if (token) {
      setAuthToken(token);
      return token;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
