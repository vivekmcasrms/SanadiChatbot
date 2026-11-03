/**
 * Appointment REQUESTS (Mode B) — the office side.
 *
 * A preferred time is only a request. The responsible officer confirms it,
 * suggests another time, asks for more information, or declines with a reason;
 * an alternative only becomes an appointment once the student accepts it.
 * Every read and write runs as the signed-in user, so RLS decides who may see
 * or change a request.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppointmentRequestView = {
  id: string;
  caseId: string | null;
  reference: string | null;
  studentId: string;
  studentName: string | null;
  studentNumber: string | null;
  unitId: string | null;
  unitName: string | null;
  preferredDatetime: string;
  alternativeDatetime: string | null;
  confirmedDatetime: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedStaffEmail: string | null;
  assignmentMethod: string | null;
  assignedAt: string | null;
  workloadAtAssignment: number | null;
  requestStatus: string;
  confirmationStatus: string;
  purpose: string | null;
  declineReason: string | null;
  location: string | null;
  officeResponseAt: string | null;
  studentResponseAt: string | null;
  isMine: boolean;
};

const REQUEST_COLUMNS =
  "id, case_id, reference, student_id, service_unit_id, preferred_datetime, alternative_datetime, confirmed_datetime, assigned_staff_id, assignment_method, assigned_at, workload_at_assignment, request_status, confirmation_status, purpose, decline_reason, location, office_response_at, student_response_at";

type Row = Record<string, unknown>;

async function decorate(
  db: { from: (t: string) => any },
  rows: Row[],
  viewerId: string,
): Promise<AppointmentRequestView[]> {
  if (!rows.length) return [];
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r["student_id"], r["assigned_staff_id"]].filter(Boolean) as string[]),
    ),
  ];
  const unitIds = [...new Set(rows.map((r) => r["service_unit_id"]).filter(Boolean) as string[])];
  const [{ data: people }, { data: units }, { data: students }] = await Promise.all([
    db.from("profiles").select("id, full_name, email").in("id", ids),
    unitIds.length
      ? db.from("service_units").select("id, name_en").in("id", unitIds)
      : Promise.resolve({ data: [] }),
    db.from("student_profiles").select("user_id, student_number").in("user_id", ids),
  ]);
  const person = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p]),
  );
  const unit = new Map(((units ?? []) as { id: string; name_en: string }[]).map((u) => [u.id, u.name_en]));
  const number = new Map(
    ((students ?? []) as { user_id: string; student_number: string | null }[]).map((s) => [
      s.user_id,
      s.student_number,
    ]),
  );

  return rows.map((r) => {
    const staffId = (r["assigned_staff_id"] as string | null) ?? null;
    const studentId = r["student_id"] as string;
    return {
      id: r["id"] as string,
      caseId: (r["case_id"] as string | null) ?? null,
      reference: (r["reference"] as string | null) ?? null,
      studentId,
      studentName: person.get(studentId)?.full_name ?? null,
      studentNumber: number.get(studentId) ?? null,
      unitId: (r["service_unit_id"] as string | null) ?? null,
      unitName: r["service_unit_id"] ? (unit.get(r["service_unit_id"] as string) ?? null) : null,
      preferredDatetime: r["preferred_datetime"] as string,
      alternativeDatetime: (r["alternative_datetime"] as string | null) ?? null,
      confirmedDatetime: (r["confirmed_datetime"] as string | null) ?? null,
      assignedStaffId: staffId,
      assignedStaffName: staffId ? (person.get(staffId)?.full_name ?? null) : null,
      assignedStaffEmail: staffId ? (person.get(staffId)?.email ?? null) : null,
      assignmentMethod: (r["assignment_method"] as string | null) ?? null,
      assignedAt: (r["assigned_at"] as string | null) ?? null,
      workloadAtAssignment: (r["workload_at_assignment"] as number | null) ?? null,
      requestStatus: (r["request_status"] as string) ?? "REQUESTED",
      confirmationStatus: (r["confirmation_status"] as string) ?? "AWAITING_OFFICE_CONFIRMATION",
      purpose: (r["purpose"] as string | null) ?? null,
      declineReason: (r["decline_reason"] as string | null) ?? null,
      location: (r["location"] as string | null) ?? null,
      officeResponseAt: (r["office_response_at"] as string | null) ?? null,
      studentResponseAt: (r["student_response_at"] as string | null) ?? null,
      isMine: studentId === viewerId,
    };
  });
}

/** The appointment request attached to one case, if there is one. */
export const getCaseAppointmentRequestFn = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { data: rows } = await db
      .from("appointment_requests")
      .select(REQUEST_COLUMNS)
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(1);
    const list = await decorate(db, (rows ?? []) as Row[], context.userId);
    return list[0] ?? null;
  });

/** Open appointment requests assigned to the signed-in officer. */
export const listMyAppointmentRequestsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { data: rows } = await db
      .from("appointment_requests")
      .select(REQUEST_COLUMNS)
      .eq("assigned_staff_id", context.userId)
      .order("preferred_datetime", { ascending: true })
      .limit(100);
    return decorate(db, (rows ?? []) as Row[], context.userId);
  });

const respondInput = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["confirm", "propose", "request_info", "decline", "student_accept", "student_cancel"]),
  alternativeDatetime: z.string().datetime().optional(),
  location: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
});

/**
 * One transition of the request lifecycle. The status vocabulary is fixed:
 * REQUESTED → ASSIGNED → AWAITING_OFFICE_CONFIRMATION → CONFIRMED, or
 * ALTERNATIVE_PROPOSED → AWAITING_STUDENT_CONFIRMATION → CONFIRMED, or
 * DECLINED / CANCELLED.
 */
export const respondToAppointmentRequestFn = createServerFn({ method: "POST" })
  .inputValidator((d) => respondInput.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { data: current } = await db
      .from("appointment_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", data.requestId)
      .maybeSingle();
    if (!current) throw new Error("Appointment request not found.");

    const now = new Date().toISOString();
    const isStudent = current["student_id"] === context.userId;
    const patch: Record<string, unknown> = {};

    switch (data.action) {
      case "confirm":
        patch["request_status"] = "CONFIRMED";
        patch["confirmation_status"] = "CONFIRMED";
        patch["confirmed_datetime"] = current["preferred_datetime"];
        patch["office_response_at"] = now;
        if (data.location) patch["location"] = data.location;
        break;
      case "propose":
        if (!data.alternativeDatetime) throw new Error("Choose the alternative time first.");
        patch["request_status"] = "ALTERNATIVE_PROPOSED";
        patch["confirmation_status"] = "AWAITING_STUDENT_CONFIRMATION";
        patch["alternative_datetime"] = data.alternativeDatetime;
        patch["office_response_at"] = now;
        if (data.location) patch["location"] = data.location;
        break;
      case "request_info":
        patch["request_status"] = "AWAITING_OFFICE_CONFIRMATION";
        patch["office_response_at"] = now;
        break;
      case "decline":
        patch["request_status"] = "DECLINED";
        patch["confirmation_status"] = "DECLINED";
        patch["decline_reason"] = data.message ?? null;
        patch["office_response_at"] = now;
        break;
      case "student_accept":
        if (!isStudent) throw new Error("Only the student can accept the suggested time.");
        if (!current["alternative_datetime"]) throw new Error("No alternative time was suggested.");
        patch["request_status"] = "CONFIRMED";
        patch["confirmation_status"] = "CONFIRMED";
        patch["confirmed_datetime"] = current["alternative_datetime"];
        patch["student_response_at"] = now;
        break;
      case "student_cancel":
        if (!isStudent) throw new Error("Only the student can cancel their request.");
        patch["request_status"] = "CANCELLED";
        patch["confirmation_status"] = "CANCELLED";
        patch["student_response_at"] = now;
        break;
    }

    const { error } = await db.from("appointment_requests").update(patch).eq("id", data.requestId);
    if (error) throw new Error(error.message);

    // The case thread carries the human-readable trail for both sides.
    if (current["case_id"] && data.message) {
      await db.from("case_comments").insert({
        case_id: current["case_id"],
        author_id: context.userId,
        body: data.message,
        is_internal: false,
      });
    }

    const { notifyRequestParties } = await import("@/lib/agent/appointment-request.server");
    const when = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Dubai",
    }).format(
      new Date(
        (patch["confirmed_datetime"] as string) ??
          (patch["alternative_datetime"] as string) ??
          (current["preferred_datetime"] as string),
      ),
    );
    await notifyRequestParties({
      event:
        patch["request_status"] === "CONFIRMED"
          ? "appointment_request_confirmed"
          : patch["request_status"] === "ALTERNATIVE_PROPOSED"
            ? "appointment_request_alternative"
            : "appointment_request_updated",
      requestId: data.requestId,
      studentId: current["student_id"] as string,
      staffUserId: (current["assigned_staff_id"] as string | null) ?? null,
      unitId: (current["service_unit_id"] as string | null) ?? null,
      unitLabel: null,
      lang: "en",
      when,
    });

    return { ok: true, status: patch["request_status"] as string };
  });
