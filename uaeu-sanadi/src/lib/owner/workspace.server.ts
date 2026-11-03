import { getActiveRoles } from "@/lib/authz/roles.server";
/**
 * Service Owner workspace scoping.
 *
 * A Service Owner sees only what they own. Unit membership is resolved from the
 * database (home unit + active owner assignments), never from anything the
 * browser sends, and every read below runs through the caller's RLS-scoped
 * client so the database enforces the same boundary a second time.
 */
import type { Db } from "../agent/tools.server";

/** Service-specific operational surfaces a unit may legitimately expose. */
export type UnitCapability = never;

/**
 * Capabilities are derived from the unit itself, never from a generic template.
 * The lean production build ships no service-specific owner tooling.
 */
const UNIT_CAPABILITIES: Record<string, UnitCapability[]> = {};

export type OwnedUnit = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  ownershipType: string;
  capabilities: UnitCapability[];
};

export type OwnerAction = {
  code: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  riskLevel: string;
};

export type OwnerWorkspace = {
  units: OwnedUnit[];
  roles: string[];
  isOwner: boolean;
  isManager: boolean;
  /** Managers/admins are not unit-bound and may see every unit. */
  seesAllUnits: boolean;
  actionsByUnit: Record<string, OwnerAction[]>;
};

const MANAGER_ROLES = ["service_manager", "system_admin"];

export async function loadOwnerWorkspace(db: Db, userId: string): Promise<OwnerWorkspace> {
  const [roles, { data: profile }, { data: owned }] = await Promise.all([
    getActiveRoles(db, userId),
    db.from("staff_profiles").select("service_unit_id").eq("user_id", userId).maybeSingle(),
    db
      .from("service_unit_owners")
      .select("service_unit_id, ownership_type, is_active, ended_at")
      .eq("staff_profile_id", userId)
      .eq("is_active", true),
  ]);

  const isManager = roles.some((r) => MANAGER_ROLES.includes(r));
  const isOwner = roles.includes("service_owner");

  const ownership = new Map<string, string>();
  if (profile?.service_unit_id) ownership.set(profile.service_unit_id, "assigned_staff");
  for (const row of owned ?? []) {
    if (row.ended_at && new Date(row.ended_at).getTime() < Date.now()) continue;
    ownership.set(row.service_unit_id, row.ownership_type ?? "primary");
  }

  const ids = [...ownership.keys()];
  const seesAllUnits = isManager && ids.length === 0;

  const { data: unitRows } = ids.length
    ? await db.from("service_units").select("id, code, name_en, name_ar").in("id", ids)
    : seesAllUnits
      ? await db.from("service_units").select("id, code, name_en, name_ar").eq("is_active", true).limit(50)
      : { data: [] as never[] };

  const units: OwnedUnit[] = ((unitRows ?? []) as { id: string; code: string; name_en: string; name_ar: string }[])
    .map((u) => ({
      id: u.id,
      code: u.code,
      nameEn: u.name_en,
      nameAr: u.name_ar,
      ownershipType: ownership.get(u.id) ?? "oversight",
      capabilities: UNIT_CAPABILITIES[u.code] ?? [],
    }))
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));

  const { data: perms } = units.length
    ? await db
        .from("service_owner_action_permissions")
        .select("service_unit_id, action_code, enabled, requires_confirmation, requires_reason, risk_level")
        .in(
          "service_unit_id",
          units.map((u) => u.id),
        )
    : { data: [] as never[] };

  const actionsByUnit: Record<string, OwnerAction[]> = {};
  for (const u of units) actionsByUnit[u.id] = [];
  for (const p of (perms ?? []) as {
    service_unit_id: string;
    action_code: string;
    enabled: boolean;
    requires_confirmation: boolean;
    requires_reason: boolean;
    risk_level: string;
  }[]) {
    (actionsByUnit[p.service_unit_id] ??= []).push({
      code: p.action_code,
      enabled: p.enabled,
      requiresConfirmation: p.requires_confirmation,
      requiresReason: p.requires_reason,
      riskLevel: p.risk_level,
    });
  }

  return { units, roles, isOwner, isManager, seesAllUnits, actionsByUnit };
}

/** Narrow a requested unit to one the caller actually owns. */
export function resolveScope(ws: OwnerWorkspace, requestedUnitId?: string | null): string[] {
  const owned = ws.units.map((u) => u.id);
  if (requestedUnitId && owned.includes(requestedUnitId)) return [requestedUnitId];
  return owned;
}

/**
 * Canonical case visibility for a staff member: every case inside the units
 * they supervise, plus every case assigned to them personally. A case that is
 * assigned to someone must never be invisible to that person, whatever unit it
 * belongs to — a critical alert depends on it.
 */
export function caseVisibilityFilter(scope: string[], userId: string): string {
  return scope.length
    ? `service_unit_id.in.(${scope.join(",")}),assigned_to.eq.${userId}`
    : `assigned_to.eq.${userId}`;
}

export function canDo(ws: OwnerWorkspace, unitId: string, action: string): OwnerAction | null {
  if (ws.isManager) {
    return { code: action, enabled: true, requiresConfirmation: true, requiresReason: true, riskLevel: "medium" };
  }
  const hit = (ws.actionsByUnit[unitId] ?? []).find((a) => a.code === action);
  return hit && hit.enabled ? hit : null;
}
