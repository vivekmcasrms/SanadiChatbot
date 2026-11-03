/** Role checks for library administration endpoints. SERVER ONLY. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };

const ADMIN_ROLES = ["system_admin", "integration_admin", "knowledge_manager", "service_manager"] as const;

/** Throws unless the caller holds an administrative role. */
export async function assertLibraryAdmin(db: Db, userId: string): Promise<void> {
  for (const role of ADMIN_ROLES) {
    const { data, error } = await db.rpc("has_role", { _user_id: userId, _role: role });
    if (!error && data === true) return;
  }
  throw new Error("Administrator access is required for library integration settings.");
}
