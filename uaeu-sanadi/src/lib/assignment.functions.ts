/** Staff assignment: who is responsible, reassignment, and unit workload. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const caseInput = (d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d);

/**
 * The responsible person a student may see: name, unit and university email only.
 * RLS on cases decides whether the caller may read the case at all.
 */
export const getCaseResponsibleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(caseInput)
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("cases")
      .select("id, case_number, status, assigned_to, service_unit_id, assignment_method, needs_assignment_attention")
      .eq("id", data.caseId)
      .maybeSingle();
    if (!row) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [person, role, unit] = await Promise.all([
      row.assigned_to
        ? supabaseAdmin.from("profiles").select("full_name, email, phone").eq("id", row.assigned_to).maybeSingle()
        : Promise.resolve({ data: null }),
      row.assigned_to
        ? supabaseAdmin
            .from("staff_profiles")
            .select("job_title_en, job_title_ar")
            .eq("user_id", row.assigned_to)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      row.service_unit_id
        ? supabaseAdmin
            .from("service_units")
            .select("name_en, name_ar, contact_email")
            .eq("id", row.service_unit_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const phone = person.data?.phone?.trim() || null;
    return {
      caseNumber: row.case_number,
      status: row.status,
      /** False while the unit has the case but nobody has been named yet. */
      assigned: Boolean(person.data?.full_name),
      staffName: person.data?.full_name ?? null,
      staffEmail: person.data?.email ?? null,
      /** Only ever a real configured number; never a placeholder. */
      staffPhone: phone,
      staffRoleEn: role.data?.job_title_en ?? null,
      staffRoleAr: role.data?.job_title_ar ?? null,
      unitNameEn: unit.data?.name_en ?? null,
      unitNameAr: unit.data?.name_ar ?? null,
      unitEmail: unit.data?.contact_email ?? null,
      /** True when the case is with the central service desk rather than the original unit. */
      serviceDesk: row.assignment_method === "SERVICE_DESK_FALLBACK",
      escalated: Boolean(row.needs_assignment_attention) && !person.data?.full_name,
    };
  });

/** Active, available staff of a unit with their live workload (staff/admin only). */
export const listUnitStaffWorkloadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ unitId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (error) throw new Error("Staff list is unavailable right now. Please try again.");
    if (!allowed) throw new Error("Forbidden");
    const { unitWorkload } = await import("./ops/assignment.server");
    return unitWorkload(data.unitId);
  });

/** Reassign a case to another staff member. Admins and unit assigners only. */
export const reassignCaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        staffId: z.string().uuid(),
        reason: z.string().min(3).max(500),
        /** Assignee the staff member saw; a mismatch means the view is stale. */
        expectedAssignee: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { must } = await import("@/lib/result");
    const { checked } = await import("@/lib/exceptions/handle.server");
    const { staffCapabilities, isEligibleAssignee, isStaleChange, STALE_MESSAGE } = await import("./ops/staff-workspace");
    const ops = await import("./ops/case-actions.server");
    const roles = await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);

    const row = must(
      await supabaseAdmin
        .from("cases")
        .select("id, case_number, service_unit_id, assigned_to, student_id, language")
        .eq("id", data.caseId)
        .maybeSingle(),
      "staff_operations",
    );
    if (!row) throw new Error("Case not found");
    if (isStaleChange(data.expectedAssignee, row.assigned_to)) throw new Error(STALE_MESSAGE.en);

    const perm = must(
      await supabaseAdmin
        .from("service_staff")
        .select("can_assign_cases, is_active")
        .eq("staff_profile_id", context.userId)
        .eq("service_unit_id", row.service_unit_id ?? "")
        .maybeSingle(),
      "staff_operations",
    );
    const caps = staffCapabilities(roles, { unitAssigner: Boolean(perm?.is_active && perm.can_assign_cases) });
    if (!caps.reassign) throw new Error("Forbidden: you cannot reassign requests in this unit");

    const { workloadFor, recordAssignment, responsiblePersonFor, unitWorkload } = await import("./ops/assignment.server");
    if (!row.service_unit_id || !isEligibleAssignee(data.staffId, await unitWorkload(row.service_unit_id))) {
      throw new Error("That staff member is not active and available in this unit.");
    }
    const load = await workloadFor([data.staffId]);

    await checked(supabaseAdmin
      .from("cases")
      .update({
        assigned_to: data.staffId,
        assignment_method: "MANUAL_REASSIGNMENT",
        assigned_at: new Date().toISOString(),
        workload_at_assignment: load.get(data.staffId)?.weighted ?? 0,
        needs_assignment_attention: false,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", data.caseId), "staff_operations", "cases", true);

    await recordAssignment({
      caseId: data.caseId,
      unitId: row.service_unit_id,
      staffId: data.staffId,
      method: "MANUAL_REASSIGNMENT",
      workload: load.get(data.staffId)?.weighted ?? 0,
      assignedBy: context.userId,
      reason: data.reason,
    });

    const { emitNotification } = await import("./ops/notify.server");
    const person = await responsiblePersonFor(data.caseId);
    await emitNotification({
      eventType: "new_assignment",
      entityType: "case",
      entityId: data.caseId,
      recipientId: data.staffId,
      vars: { case_number: row.case_number },
      actionUrl: `/requests/${data.caseId}`,
      dedupeKey: `reassign:${data.caseId}:${data.staffId}:${Date.now()}`,
    });
    await emitNotification({
      eventType: "case_assigned",
      entityType: "case",
      entityId: data.caseId,
      recipientId: row.student_id,
      language: (row.language as "en" | "ar") ?? "en",
      vars: {
        case_number: row.case_number,
        staff_name: person?.staffName ?? "",
        unit: person?.unitName ?? "",
        staff_email: person?.staffEmail ?? "",
      },
      actionUrl: `/requests/${data.caseId}`,
      dedupeKey: `reassign-student:${data.caseId}:${data.staffId}`,
    });

    return { ok: true, previousAssignee: row.assigned_to };
  });

/**
 * Assignee picker for one case: active, available staff of the case's unit,
 * with live workload. Only staff who can access the case may list them.
 */
export const listCaseAssigneesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./ops/case-actions.server");
    const roles = await ops.assertStaff(context.userId);
    await ops.assertCaseAccess(data.caseId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { must } = await import("@/lib/result");
    const row = must(
      await supabaseAdmin.from("cases").select("service_unit_id, assigned_to").eq("id", data.caseId).maybeSingle(),
      "staff_operations",
    );
    const perm = must(
      await supabaseAdmin
        .from("service_staff")
        .select("can_assign_cases, is_active")
        .eq("staff_profile_id", context.userId)
        .eq("service_unit_id", row?.service_unit_id ?? "")
        .maybeSingle(),
      "staff_operations",
    );
    const { staffCapabilities, eligibleAssignees } = await import("./ops/staff-workspace");
    const caps = staffCapabilities(roles, { unitAssigner: Boolean(perm?.is_active && perm.can_assign_cases) });
    if (!row?.service_unit_id) return { assignedTo: row?.assigned_to ?? null, canReassign: false, options: [] };
    const { unitWorkload } = await import("./ops/assignment.server");
    const options = eligibleAssignees(await unitWorkload(row.service_unit_id)).map((r) => ({
      staffId: r.staffId,
      fullName: r.fullName,
      workload: r.workload,
      activeCases: r.activeCases,
    }));
    return { assignedTo: row.assigned_to, canReassign: caps.reassign, options };
  });
