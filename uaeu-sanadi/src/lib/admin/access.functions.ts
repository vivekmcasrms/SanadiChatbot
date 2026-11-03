import { auditInsert } from "@/lib/exceptions/handle.server";
/**
 * Access governance for Admin: see who holds staff access, and withdraw or
 * restore it in one action.
 *
 * Withdrawal is deliberately a single write that every permission check in the
 * database already reads (`profiles.access_revoked_at`, honoured by
 * `has_role`, `is_staff`, `is_manager` and `can_see_all_cases`), so access ends
 * immediately everywhere. History is never deleted: cases, assignments and the
 * audit log keep pointing at the person.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { OPEN_STATUSES } from "@/lib/lists/case-status";


async function assertAdmin(context: {
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "system_admin" }) => PromiseLike<{ data: unknown }> };
  userId: string;
}) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "system_admin" });
  if (!data) throw new Error("Forbidden");
}

export type StaffAccessRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  roles: string[];
  revokedAt: string | null;
  revokedReason: string | null;
  openCases: number;
};

/** Every account holding a staff role, with live open-case counts. */
export const listStaffAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffAccessRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .neq("role", "student")
      .limit(5000);
    const byUser = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      if (!r.user_id) continue;
      byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), String(r.role)]);
    }
    const ids = [...byUser.keys()];
    if (!ids.length) return [];

    const [{ data: people }, { data: cases }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, access_revoked_at, access_revoked_reason")
        .in("id", ids)
        .limit(5000),
      supabaseAdmin
        .from("cases")
        .select("assigned_to")
        .in("assigned_to", ids)
        .in("status", OPEN_STATUSES as never[])
        .limit(10000),
    ]);
    const open = new Map<string, number>();
    for (const c of cases ?? []) {
      if (c.assigned_to) open.set(c.assigned_to, (open.get(c.assigned_to) ?? 0) + 1);
    }

    return (people ?? [])
      .map((p) => ({
        userId: p.id,
        fullName: p.full_name,
        email: p.email,
        roles: byUser.get(p.id) ?? [],
        revokedAt: p.access_revoked_at ?? null,
        revokedReason: p.access_revoked_reason ?? null,
        openCases: open.get(p.id) ?? 0,
      }))
      .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
  });

/**
 * One-step withdrawal: block access, stop new assignments, optionally hand the
 * person's open cases to the next available colleague, and record the reason.
 */
export const revokeStaffAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
        reassignOpenCases: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot withdraw your own access.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    await supabaseAdmin
      .from("profiles")
      .update({
        access_revoked_at: now,
        access_revoked_by: context.userId,
        access_revoked_reason: data.reason,
      })
      .eq("id", data.userId);

    // Stop any new work reaching them.
    await supabaseAdmin
      .from("staff_profiles")
      .update({ is_active: false, availability_status: "unavailable" })
      .eq("user_id", data.userId);
    await supabaseAdmin
      .from("service_staff")
      .update({ is_active: false, can_receive_cases: false, can_assign_cases: false })
      .eq("staff_profile_id", data.userId);

    let reassigned = 0;
    let flagged = 0;
    if (data.reassignOpenCases) {
      const { data: open } = await supabaseAdmin
        .from("cases")
        .select("id, service_unit_id, case_number")
        .eq("assigned_to", data.userId)
        .in("status", OPEN_STATUSES as never[])
        .limit(500);

      const { selectAssignee, recordAssignment, workloadFor } = await import("@/lib/ops/assignment.server");
      for (const row of open ?? []) {
        const pick = row.service_unit_id
          ? await selectAssignee({ unitId: row.service_unit_id, caseId: row.id })
          : { staffId: null, method: "UNASSIGNED", workload: null, needsAdminAttention: true };
        const nextId = pick.staffId && pick.staffId !== data.userId ? pick.staffId : null;
        const load = nextId ? (await workloadFor([nextId])).get(nextId)?.weighted ?? 0 : null;
        await supabaseAdmin
          .from("cases")
          .update({
            assigned_to: nextId,
            assignment_method: nextId ? "ACCESS_WITHDRAWN_REASSIGNMENT" : null,
            assigned_at: nextId ? now : null,
            workload_at_assignment: load,
            needs_assignment_attention: !nextId,
            last_activity_at: now,
          })
          .eq("id", row.id);
        await recordAssignment({
          caseId: row.id,
          unitId: row.service_unit_id,
          staffId: nextId,
          method: "ACCESS_WITHDRAWN_REASSIGNMENT",
          workload: load,
          assignedBy: context.userId,
          reason: `Access withdrawn: ${data.reason}`,
        });
        if (nextId) {
          reassigned += 1;
          const { emitNotification } = await import("@/lib/ops/notify.server");
          await emitNotification({
            eventType: "new_assignment",
            entityType: "case",
            entityId: row.id,
            recipientId: nextId,
            vars: { case_number: row.case_number },
            actionUrl: `/requests/${row.id}`,
            dedupeKey: `revoke-reassign:${row.id}:${nextId}`,
          });
        } else {
          flagged += 1;
        }
      }
    }

    await auditInsert(supabaseAdmin, {
      actor_id: context.userId,
      action: "staff_access_revoked",
      entity_type: "profile",
      entity_id: data.userId,
      metadata: { reason: data.reason, reassigned, flagged } as never,
    });

    return { ok: true, reassigned, flagged };
  });

/** Restore withdrawn access. Roles were never deleted, so nothing is re-granted. */
export const restoreStaffAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("profiles")
      .update({ access_revoked_at: null, access_revoked_by: null, access_revoked_reason: null })
      .eq("id", data.userId);
    await supabaseAdmin
      .from("staff_profiles")
      .update({ is_active: true, availability_status: "available" })
      .eq("user_id", data.userId);
    await supabaseAdmin
      .from("service_staff")
      .update({ is_active: true, can_receive_cases: true })
      .eq("staff_profile_id", data.userId);
    await auditInsert(supabaseAdmin, {
      actor_id: context.userId,
      action: "staff_access_restored",
      entity_type: "profile",
      entity_id: data.userId,
      metadata: {} as never,
    });
    return { ok: true };
  });

export type AccessAuditRow = {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  subjectName: string | null;
  reason: string | null;
  reassigned: number | null;
};

/** Audit trail of permission and access changes, newest first. */
export const listAccessAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessAuditRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("audit_logs")
      .select("id, action, created_at, actor_id, entity_id, metadata")
      .in("action", ["staff_access_revoked", "staff_access_restored", "role_granted", "role_revoked"])
      .order("created_at", { ascending: false })
      .limit(50);

    const ids = [
      ...new Set((rows ?? []).flatMap((r) => [r.actor_id, r.entity_id]).filter((x): x is string => !!x)),
    ];
    const names = new Map<string, string | null>();
    if (ids.length) {
      const { data: people } = await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ids);
      for (const p of people ?? []) names.set(p.id, p.full_name ?? p.email);
    }

    return (rows ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as { reason?: string; reassigned?: number };
      return {
        id: r.id,
        action: r.action,
        at: r.created_at,
        actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
        subjectName: r.entity_id ? names.get(r.entity_id) ?? null : null,
        reason: typeof meta.reason === "string" ? meta.reason : null,
        reassigned: typeof meta.reassigned === "number" ? meta.reassigned : null,
      };
    });
  });
