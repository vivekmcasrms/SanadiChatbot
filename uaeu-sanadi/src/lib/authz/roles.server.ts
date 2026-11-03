/**
 * The only way server code reads a user's roles for authorization.
 * Calls the database `active_roles` function, which drops every non-student
 * role once access is revoked or the sign-in account is disabled/deleted.
 * Never read `user_roles` directly to decide access.
 */
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => any; from: (t: string) => any };

export async function getActiveRoles(db: unknown, userId: string): Promise<string[]> {
  const { data, error } = await (db as RpcClient).rpc("active_roles", { _user_id: userId });
  if (error) throw new Error("Could not verify access.");
  return ((data ?? []) as string[]).map(String);
}

export async function requireAnyRole(db: unknown, userId: string, allowed: readonly string[]): Promise<string[]> {
  const roles = await getActiveRoles(db, userId);
  if (!roles.some((r) => allowed.includes(r))) throw new Error("Forbidden");
  return roles;
}

/** Users holding any of `roles` whose access is still active (privileged client only). */
export async function activeRoleHolders(roles: readonly string[], limit = 200): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as RpcClient;
  const { data } = await db.from("user_roles").select("user_id").in("role", roles as never[]).limit(limit);
  return filterActiveUsers([...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))]);
}

/** Removes revoked or disabled accounts from a candidate list. */
export async function filterActiveUsers(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as RpcClient;
  const checks = await Promise.all(
    ids.map(async (id) => {
      const { data } = await db.rpc("is_access_revoked", { _user_id: id });
      return data === true ? null : id;
    }),
  );
  return checks.filter((x): x is string => !!x);
}
