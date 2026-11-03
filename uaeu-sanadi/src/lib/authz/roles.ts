/**
 * Pure authorization rules shared by every privileged check.
 * The database function `active_roles` applies the same rule server-side;
 * this module exists so the rule can be unit-tested and reused for decisions.
 */
export type AccountState = {
  roles: string[];
  /** profiles.access_revoked_at is set */
  revoked?: boolean;
  /** sign-in account disabled (banned) or deleted */
  disabled?: boolean;
};

export const STAFF_ROLES = [
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "knowledge_approver",
  "system_admin",
  "auditor",
  "leadership_viewer",
  "integration_admin",
] as const;

/** Revoked or disabled accounts keep only the student role. */
export function effectiveRoles(state: AccountState): string[] {
  const unique = [...new Set(state.roles)];
  if (state.revoked || state.disabled) return unique.filter((r) => r === "student");
  return unique;
}

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

export type UnitScope = { unitIds: readonly string[]; targetUnitId?: string | null };

/**
 * Decide a privileged operation. Admins are unit-unrestricted; everyone else
 * needs an allowed role and, when a target unit is given, membership of it.
 */
export function authorize(
  state: AccountState,
  allowed: readonly string[],
  scope?: UnitScope,
): { ok: true } | { ok: false; reason: "revoked" | "role" | "unit" } {
  const roles = effectiveRoles(state);
  if ((state.revoked || state.disabled) && hasAnyRole(state.roles, allowed)) return { ok: false, reason: "revoked" };
  if (!hasAnyRole(roles, allowed)) return { ok: false, reason: "role" };
  if (scope?.targetUnitId && !roles.includes("system_admin") && !scope.unitIds.includes(scope.targetUnitId)) {
    return { ok: false, reason: "unit" };
  }
  return { ok: true };
}
