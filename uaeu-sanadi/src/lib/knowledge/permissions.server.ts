import { getActiveRoles } from "@/lib/authz/roles.server";
/** Knowledge & Integrations Center authorisation. Server only. */
import type { Db } from "../agent/tools.server";

export type CenterPermissions = {
  roles: string[];
  isStaff: boolean;
  isAdmin: boolean;
  isAuditor: boolean;
  canViewCenter: boolean;
  canManageKnowledge: boolean;
  canApproveKnowledge: boolean;
  canManageIntegrations: boolean;
};

const STAFF_ROLES = [
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "knowledge_approver",
  "integration_admin",
  "system_admin",
  "auditor",
  "leadership_viewer",
];

export async function loadPermissions(db: Db, userId: string): Promise<CenterPermissions> {
  const roles = await getActiveRoles(db, userId);
  const has = (r: string) => roles.includes(r);
  const isAdmin = has("system_admin");
  return {
    roles,
    isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
    isAdmin,
    isAuditor: has("auditor"),
    canViewCenter: roles.some((r) => STAFF_ROLES.includes(r)),
    canManageKnowledge: isAdmin || has("knowledge_manager") || has("knowledge_approver"),
    canApproveKnowledge: isAdmin || has("knowledge_approver"),
    canManageIntegrations: isAdmin || has("integration_admin"),
  };
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Immutable audit entry for every consequential operation in the centre. */
export async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.from("knowledge_audit_log").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    details: details as never,
  });
}

/** Confidentiality ordering used to filter retrieval by the caller's clearance. */
export const CONFIDENTIALITY_ORDER = [
  "public",
  "student_authenticated",
  "staff_only",
  "restricted",
  "highly_restricted",
] as const;

export function clearanceFor(perms: CenterPermissions): number {
  if (perms.isAdmin) return 4;
  if (perms.canManageKnowledge || perms.canManageIntegrations) return 3;
  if (perms.isStaff) return 2;
  return 1;
}

export function allowedConfidentiality(level: string, clearance: number): boolean {
  const idx = CONFIDENTIALITY_ORDER.indexOf(level as (typeof CONFIDENTIALITY_ORDER)[number]);
  return idx === -1 ? false : idx <= clearance;
}

/** Synchronous clearance derivation for callers that already loaded the roles. */
export function permsFromRoles(roles: string[]): CenterPermissions {
  const has = (r: string) => roles.includes(r);
  const isAdmin = has("system_admin");
  return {
    roles,
    isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
    isAdmin,
    isAuditor: has("auditor"),
    canViewCenter: roles.some((r) => STAFF_ROLES.includes(r)),
    canManageKnowledge: isAdmin || has("knowledge_manager") || has("knowledge_approver"),
    canApproveKnowledge: isAdmin || has("knowledge_approver"),
    canManageIntegrations: isAdmin || has("integration_admin"),
  };
}
