/** Admin/owner-facing availability administration. Server only. */
import type { Db } from "./availability.server";
import { getServiceAvailabilityById } from "./availability.server";

export type WindowInput = {
  id?: string | null | undefined;
  serviceId: string;
  availabilityType:
    | "always_available"
    | "date_range"
    | "term_based"
    | "multiple_windows"
    | "temporarily_closed"
    | "admin_disabled";
  opensAt?: string | null | undefined;
  closesAt?: string | null | undefined;
  academicTermId?: string | null | undefined;
  label?: string | null | undefined;
  reasonEn?: string | null | undefined;
  reasonAr?: string | null | undefined;
  studentMessageEn?: string | null | undefined;
  studentMessageAr?: string | null | undefined;
  remindersEnabled?: boolean | undefined;
  preliminaryCheckAllowed?: boolean | undefined;
  studentVisible?: boolean | undefined;
  status?: "active" | "archived" | undefined;
};

async function assertAdmin(db: Db, userId: string) {
  const { data } = await db.rpc("has_role", { _user_id: userId, _role: "system_admin" });
  if (data !== true) throw new Error("Only system administrators may change service availability.");
}

/** Every service with its live availability plus configured windows. */
export async function serviceAvailabilityOverview(db: Db) {
  const [{ data: services }, { data: windows }] = await Promise.all([
    db
      .from("university_services")
      .select("id, code, name_en, name_ar, category, is_active, service_unit_id")
      .order("name_en"),
    db
      .from("service_availability_windows")
      .select(
        "id, service_id, availability_type, opens_at, closes_at, status, label, reason_en, reason_ar, student_message_en, student_message_ar, reminders_enabled, preliminary_check_allowed, student_visible, academic_term_id, updated_at",
      )
      .order("opens_at", { ascending: true, nullsFirst: true }),
  ]);

  const list = services ?? [];
  const availability = await Promise.all(list.map((s) => getServiceAvailabilityById(db, s.id)));

  return list.map((s, i) => ({
    service: s,
    availability: availability[i]!,
    windows: (windows ?? []).filter((w) => w.service_id === s.id),
  }));
}

export async function saveAvailabilityWindow(db: Db, userId: string, input: WindowInput) {
  await assertAdmin(db, userId);
  const dated = ["date_range", "term_based", "multiple_windows"].includes(input.availabilityType);
  const row = {
    service_id: input.serviceId,
    availability_type: input.availabilityType,
    opens_at: dated ? (input.opensAt ?? null) : null,
    closes_at: dated ? (input.closesAt ?? null) : null,
    academic_term_id: input.academicTermId ?? null,
    label: input.label ?? null,
    reason_en: input.reasonEn ?? null,
    reason_ar: input.reasonAr ?? null,
    student_message_en: input.studentMessageEn ?? null,
    student_message_ar: input.studentMessageAr ?? null,
    reminders_enabled: input.remindersEnabled ?? true,
    preliminary_check_allowed: input.preliminaryCheckAllowed ?? false,
    student_visible: input.studentVisible ?? true,
    status: input.status ?? "active",
    updated_by: userId,
  };
  if (input.id) {
    const { error } = await db.from("service_availability_windows").update(row).eq("id", input.id);
    if (error) throw error;
    return { id: input.id };
  }
  const { data, error } = await db
    .from("service_availability_windows")
    .insert({ ...row, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function deleteAvailabilityWindow(db: Db, userId: string, id: string) {
  await assertAdmin(db, userId);
  const { error } = await db.from("service_availability_windows").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function availabilityAuditTrail(db: Db, serviceId?: string | null) {
  let q = db
    .from("service_availability_audit")
    .select("id, service_id, window_id, action, old_values, new_values, reason, changed_by, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (serviceId) q = q.eq("service_id", serviceId);
  const { data } = await q;
  return data ?? [];
}
