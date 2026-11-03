import { checked } from "@/lib/exceptions/handle.server";
import { filterActiveUsers } from "@/lib/authz/roles.server";
/**
 * Workload-balanced staff assignment.
 *
 * One shared place decides which staff member becomes the single responsible
 * person for a case in a unit. Nothing here knows any staff member by name:
 * candidates always come from the live staff records of the unit.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IN_PROGRESS_STATUSES, NEW_STATUSES, WAITING_STATUSES } from "@/lib/lists/case-status";

export const ASSIGNMENT_METHOD_WORKLOAD = "WORKLOAD";
export const ASSIGNMENT_METHOD_ROUND_ROBIN = "ROUND_ROBIN";
export const ASSIGNMENT_METHOD_UNIT_OWNER = "UNIT_OWNER_FALLBACK";
export const ASSIGNMENT_METHOD_SERVICE_DESK = "SERVICE_DESK_FALLBACK";
export const ASSIGNMENT_METHOD_RULE = "RULE_TARGET";
/** Last resort for a critical case: a named manager owns it personally. */
export const ASSIGNMENT_METHOD_ADMIN = "ADMIN_FALLBACK";

/** The central service desk that owns anything no staffed unit can take. */
const SERVICE_DESK_CODES = ["SERVICE_DESK", "SD", "HD"];

export async function serviceDeskUnitId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("service_units")
    .select("id, code")
    .in("code", SERVICE_DESK_CODES)
    .eq("is_active", true);
  for (const code of SERVICE_DESK_CODES) {
    const hit = (data ?? []).find((r) => r.code === code);
    if (hit) return hit.id;
  }
  return null;
}

/** Weighted workload: waiting-for-student cases occupy half the attention. */
const WEIGHT = new Map<string, number>([
  ...NEW_STATUSES.map((s) => [s, 1] as [string, number]),
  ...IN_PROGRESS_STATUSES.map((s) => [s, 1] as [string, number]),
  ...WAITING_STATUSES.map((s) => [s, 0.5] as [string, number]),
]);

export type AssignmentPick = {
  staffId: string | null;
  method: string;
  workload: number | null;
  /** True when nobody was available and Admin must look at the case. */
  needsAdminAttention: boolean;
  /** Set when responsibility moved to the service desk because the unit has nobody. */
  fallbackUnitId?: string | null;
};

export type StaffWorkload = {
  staffId: string;
  fullName: string | null;
  email: string | null;
  workload: number;
  activeCases: number;
  lastAssignedAt: string | null;
  isActive: boolean;
  availability: string;
};

/** Active, available staff who may receive cases in this unit (home unit or membership). */
export async function availableStaffForUnit(unitId: string): Promise<
  { staffId: string; lastAssignedAt: string | null }[]
> {
  const [{ data: home }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("user_id, last_assigned_at, is_active, availability_status")
      .eq("service_unit_id", unitId)
      .limit(500),
    supabaseAdmin
      .from("service_staff")
      .select("staff_profile_id")
      .eq("service_unit_id", unitId)
      .eq("is_active", true)
      .eq("can_receive_cases", true)
      .limit(500),
  ]);

  const ids = new Set<string>();
  for (const row of home ?? []) ids.add(row.user_id);
  for (const row of members ?? []) if (row.staff_profile_id) ids.add(row.staff_profile_id);
  if (!ids.size) return [];

  // Availability and active flags always come from the staff record itself.
  const { data: profiles } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id, last_assigned_at, is_active, availability_status")
    .in("user_id", [...ids])
    .limit(1000);

  return (profiles ?? [])
    .filter((p) => p.is_active !== false && (p.availability_status ?? "available") === "available")
    .map((p) => ({ staffId: p.user_id, lastAssignedAt: p.last_assigned_at ?? null }));
}

/** Live weighted workload per staff member, computed from real cases. */
export async function workloadFor(staffIds: string[]): Promise<Map<string, { weighted: number; active: number }>> {
  const load = new Map<string, { weighted: number; active: number }>(
    staffIds.map((id) => [id, { weighted: 0, active: 0 }]),
  );
  if (!staffIds.length) return load;
  const { data } = await supabaseAdmin
    .from("cases")
    .select("assigned_to, status")
    .in("assigned_to", staffIds)
    .in("status", [...WEIGHT.keys()] as never[])
    .limit(5000);
  for (const row of data ?? []) {
    if (!row.assigned_to) continue;
    const entry = load.get(row.assigned_to);
    if (!entry) continue;
    entry.weighted += WEIGHT.get(row.status) ?? 1;
    entry.active += 1;
  }
  return load;
}

/** Workload table for a unit, including unavailable staff (Admin dashboards). */
export async function unitWorkload(unitId: string): Promise<StaffWorkload[]> {
  const [{ data: home }, { data: members }] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("user_id").eq("service_unit_id", unitId).limit(500),
    supabaseAdmin
      .from("service_staff")
      .select("staff_profile_id")
      .eq("service_unit_id", unitId)
      .eq("is_active", true)
      .limit(500),
  ]);
  const idSet = new Set<string>();
  for (const r of home ?? []) idSet.add(r.user_id);
  for (const r of members ?? []) if (r.staff_profile_id) idSet.add(r.staff_profile_id);
  const ids = [...idSet];
  if (!ids.length) return [];
  const { data: profiles } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id, last_assigned_at, is_active, availability_status")
    .in("user_id", ids)
    .limit(1000);
  const [load, { data: people }] = await Promise.all([
    workloadFor(ids),
    supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ids),
  ]);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  return ids
    .map((id) => {
      const p = (profiles ?? []).find((row) => row.user_id === id);
      return {
        staffId: id,
        fullName: byId.get(id)?.full_name ?? null,
        email: byId.get(id)?.email ?? null,
        workload: load.get(id)?.weighted ?? 0,
        activeCases: load.get(id)?.active ?? 0,
        lastAssignedAt: p?.last_assigned_at ?? null,
        isActive: p?.is_active !== false,
        availability: p?.availability_status ?? "available",
      };
    })
    .sort((a, b) => b.workload - a.workload);
}

/**
 * Choose the responsible staff member for a unit.
 * Lowest live workload wins; ties break on least-recently-assigned.
 */
export async function selectAssignee(opts: {
  unitId: string;
  caseId: string;
  isSensitive?: boolean;
  method?: string;
}): Promise<AssignmentPick> {
  let candidates = (await availableStaffForUnit(opts.unitId)).slice();

  if (candidates.length) {
    const { data: conflicts } = await supabaseAdmin
      .from("case_conflicts_of_interest")
      .select("profile_id")
      .eq("case_id", opts.caseId);
    const excluded = new Set((conflicts ?? []).map((c) => c.profile_id).filter(Boolean) as string[]);
    candidates = candidates.filter((c) => !excluded.has(c.staffId));
  }

  if (candidates.length) {
    // Revoked or disabled staff never receive new assignments.
    const active = new Set(await filterActiveUsers(candidates.map((c) => c.staffId)));
    candidates = candidates.filter((c) => active.has(c.staffId));
  }

  if (candidates.length && opts.isSensitive) {
    const ids = candidates.map((c) => c.staffId);
    const [{ data: roles }, { data: cleared }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("user_id", ids)
        .in("role", ["service_manager", "system_admin"]),
      supabaseAdmin
        .from("service_staff")
        .select("staff_profile_id")
        .eq("service_unit_id", opts.unitId)
        .eq("can_view_sensitive_cases", true)
        .in("staff_profile_id", ids),
    ]);
    const allowed = new Set([
      ...(roles ?? []).map((r) => r.user_id),
      ...(cleared ?? []).map((r) => r.staff_profile_id),
    ]);
    const restricted = candidates.filter((c) => allowed.has(c.staffId));
    if (restricted.length) candidates = restricted;
  }

  if (candidates.length) {
    const load = await workloadFor(candidates.map((c) => c.staffId));
    const ranked = candidates
      .map((c) => ({
        ...c,
        weighted: load.get(c.staffId)?.weighted ?? 0,
      }))
      .sort((a, b) => {
        if (a.weighted !== b.weighted) return a.weighted - b.weighted;
        const at = a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0;
        const bt = b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0;
        return at - bt;
      });
    const winner = ranked[0]!;
    return {
      staffId: winner.staffId,
      method: opts.method === ASSIGNMENT_METHOD_ROUND_ROBIN ? ASSIGNMENT_METHOD_ROUND_ROBIN : ASSIGNMENT_METHOD_WORKLOAD,
      workload: winner.weighted,
      needsAdminAttention: false,
    };
  }

  // Nobody available in the unit: the designated unit owner takes it.
  const { data: unit } = await supabaseAdmin
    .from("service_units")
    .select("primary_service_owner_id")
    .eq("id", opts.unitId)
    .maybeSingle();
  let owner = unit?.primary_service_owner_id ?? null;
  if (!owner) {
    const { data: owners } = await supabaseAdmin
      .from("service_unit_owners")
      .select("staff_profile_id")
      .eq("service_unit_id", opts.unitId)
      .eq("is_active", true)
      .limit(1);
    owner = owners?.[0]?.staff_profile_id ?? null;
  }
  if (owner) {
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("staff_unavailable", {
      caseId: opts.caseId,
      detail: `No available staff in unit ${opts.unitId}`,
      recovered: true,
      recoveryAction: "assigned_unit_owner",
      escalated: true,
    });
    return {
      staffId: owner,
      method: ASSIGNMENT_METHOD_UNIT_OWNER,
      workload: (await workloadFor([owner])).get(owner)?.weighted ?? 0,
      needsAdminAttention: true,
      fallbackUnitId: null,
    };
  }

  // Still nobody: the central service desk owns anything a unit cannot take.
  const deskId = await serviceDeskUnitId();
  if (deskId && deskId !== opts.unitId) {
    const desk = await selectAssignee({ ...opts, unitId: deskId, method: ASSIGNMENT_METHOD_WORKLOAD });
    if (desk.staffId) {
      return {
        staffId: desk.staffId,
        method: ASSIGNMENT_METHOD_SERVICE_DESK,
        workload: desk.workload,
        needsAdminAttention: true,
        fallbackUnitId: deskId,
      };
    }
  }

  const { logException } = await import("@/lib/exceptions/handle.server");
  await logException("staff_unavailable", {
    caseId: opts.caseId,
    detail: `No available staff in unit ${opts.unitId} and no service desk cover`,
    recovered: false,
    recoveryAction: "flagged_for_admin",
    escalated: true,
  });
  return {
    staffId: null,
    method: ASSIGNMENT_METHOD_UNIT_OWNER,
    workload: null,
    needsAdminAttention: true,
    fallbackUnitId: null,
  };
}

/** Persist the assignment, its audit trail and the staff notification trigger data. */
export async function recordAssignment(opts: {
  caseId: string;
  unitId: string | null;
  staffId: string | null;
  method: string;
  workload: number | null;
  assignedBy?: string | null;
  reason?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  if (opts.staffId) {
    await checked(supabaseAdmin.from("staff_profiles").update({ last_assigned_at: now }).eq("user_id", opts.staffId), "staff_operations", "staff_profiles", false);
  }
  await checked(supabaseAdmin.from("case_assignments").insert({
    case_id: opts.caseId,
    assigned_to: opts.staffId,
    service_unit_id: opts.unitId,
    assigned_by: opts.assignedBy ?? null,
  }), "staff_operations", "case_assignments", true);
  await checked(supabaseAdmin.from("case_responsibility_history").insert({
    case_id: opts.caseId,
    actor: opts.staffId ?? "unassigned",
    actor_user_id: opts.staffId,
    service_unit_id: opts.unitId,
    reason: opts.reason ?? `Assigned by ${opts.method}`,
  }), "staff_operations", "case_responsibility_history", false);
}

/**
 * Student-facing responsible-person details: name, role, unit, university email
 * and phone. Only real configured values are returned — never a placeholder.
 */
export async function responsiblePersonFor(caseId: string): Promise<{
  staffName: string | null;
  staffEmail: string | null;
  staffPhone: string | null;
  staffRoleEn: string | null;
  staffRoleAr: string | null;
  unitName: string | null;
  unitNameAr: string | null;
} | null> {
  const { data: c } = await supabaseAdmin
    .from("cases")
    .select("assigned_to, service_unit_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!c) return null;
  const [{ data: person }, { data: role }, { data: unit }] = await Promise.all([
    c.assigned_to
      ? supabaseAdmin.from("profiles").select("full_name, email, phone").eq("id", c.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    c.assigned_to
      ? supabaseAdmin
          .from("staff_profiles")
          .select("job_title_en, job_title_ar")
          .eq("user_id", c.assigned_to)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    c.service_unit_id
      ? supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", c.service_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    staffName: person?.full_name ?? null,
    staffEmail: person?.email ?? null,
    staffPhone: person?.phone ?? null,
    staffRoleEn: role?.job_title_en ?? null,
    staffRoleAr: role?.job_title_ar ?? null,
    unitName: unit?.name_en ?? null,
    unitNameAr: unit?.name_ar ?? null,
  };
}
