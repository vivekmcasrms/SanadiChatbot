/**
 * Admin-managed appointment availability.
 *
 * Sanadi never invents appointment times. Real slots only exist once an
 * administrator publishes a weekly plan here: the plan is stored in
 * `staff_availability_rules` and expanded into `appointment_slots` rows marked
 * `data_source = 'admin'`, which is the only kind of slot the Assistant offers.
 * Authorisation is enforced in Postgres (RLS + `generate_availability_slots`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AvailabilityUnit = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  appointmentEnabled: boolean;
};

export type AvailabilityStaff = { userId: string; name: string; jobTitle: string | null };

export type AvailabilityType = {
  id: string;
  unitId: string | null;
  nameEn: string;
  nameAr: string;
  durationMinutes: number;
};

export type AvailabilityRule = {
  id: string;
  unitId: string;
  unitName: string;
  staffName: string | null;
  typeName: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  location: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  realSlots: number;
};

const admin = async (db: { rpc: (n: string, a: unknown) => Promise<{ data: unknown }> }, userId: string) => {
  const { data } = await db.rpc("has_role", { _user_id: userId, _role: "system_admin" });
  if (data !== true) throw new Error("Administrator access required.");
};

export const getAvailabilityWorkspaceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);

    const [unitsRes, rulesRes, typesRes, slotsRes] = await Promise.all([
      db.from("service_units").select("id, code, name_en, name_ar, appointment_enabled").eq("is_active", true).order("name_en"),
      db
        .from("staff_availability_rules")
        .select(
          "id, service_unit_id, staff_profile_id, appointment_type_id, weekday, start_minute, end_minute, slot_minutes, location, valid_from, valid_to, is_active",
        )
        .order("weekday"),
      db.from("appointment_types").select("id, service_unit_id, name_en, name_ar, duration_minutes").eq("is_demo_record", false).eq("is_active", true),
      db.from("appointment_slots").select("id, appointment_type_id, status, start_time").eq("is_demo_record", false).gte("start_time", new Date().toISOString()),
    ]);

    const units = (unitsRes.data ?? []).map((u) => ({
      id: u.id,
      code: u.code,
      nameEn: u.name_en,
      nameAr: u.name_ar,
      appointmentEnabled: Boolean((u as { appointment_enabled?: boolean }).appointment_enabled),
    })) as AvailabilityUnit[];

    const types = (typesRes.data ?? []).map((t) => ({
      id: t.id,
      unitId: t.service_unit_id,
      nameEn: t.name_en,
      nameAr: t.name_ar,
      durationMinutes: t.duration_minutes,
    })) as AvailabilityType[];

    const rules = rulesRes.data ?? [];
    const staffIds = [...new Set(rules.map((r) => r.staff_profile_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (staffIds.length) {
      const { data: profiles } = await db.from("profiles").select("id, full_name").in("id", staffIds);
      for (const p of profiles ?? []) names.set(p.id, p.full_name ?? "");
    }
    const slotsByType = new Map<string, number>();
    for (const s of slotsRes.data ?? []) {
      slotsByType.set(s.appointment_type_id, (slotsByType.get(s.appointment_type_id) ?? 0) + 1);
    }

    const unitName = new Map(units.map((u) => [u.id, u.nameEn]));
    const typeName = new Map(types.map((t) => [t.id, t.nameEn]));

    return {
      units,
      types,
      rules: rules.map((r) => ({
        id: r.id,
        unitId: r.service_unit_id,
        unitName: unitName.get(r.service_unit_id) ?? "",
        staffName: r.staff_profile_id ? (names.get(r.staff_profile_id) ?? null) : null,
        typeName: r.appointment_type_id ? (typeName.get(r.appointment_type_id) ?? null) : null,
        weekday: r.weekday,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        slotMinutes: r.slot_minutes,
        location: r.location,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        isActive: r.is_active,
        realSlots: r.appointment_type_id ? (slotsByType.get(r.appointment_type_id) ?? 0) : 0,
      })) as AvailabilityRule[],
      realSlotTotal: (slotsRes.data ?? []).length,
    };
  });

export const listUnitStaffFn = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ unitId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);
    const { data: staff } = await db
      .from("service_staff")
      .select("staff_profile_id")
      .eq("service_unit_id", data.unitId)
      .eq("is_active", true);
    const ids = [...new Set((staff ?? []).map((s) => s.staff_profile_id))];
    if (!ids.length) return [] as AvailabilityStaff[];
    const [{ data: profiles }, { data: sp }] = await Promise.all([
      db.from("profiles").select("id, full_name").in("id", ids),
      db.from("staff_profiles").select("user_id, job_title_en").in("user_id", ids),
    ]);
    const titles = new Map((sp ?? []).map((r) => [r.user_id, r.job_title_en]));
    return (profiles ?? []).map((p) => ({
      userId: p.id,
      name: p.full_name ?? p.id,
      jobTitle: titles.get(p.id) ?? null,
    })) as AvailabilityStaff[];
  });

export const setUnitAppointmentEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ unitId: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);
    const { error } = await db.from("service_units").update({ appointment_enabled: data.enabled }).eq("id", data.unitId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ruleInput = z.object({
  unitId: z.string().uuid(),
  staffProfileId: z.string().uuid().nullable(),
  serviceNameEn: z.string().min(2).max(80),
  serviceNameAr: z.string().min(2).max(80),
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  slotMinutes: z.number().int().min(10).max(240),
  location: z.string().max(160).nullable(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  weeks: z.number().int().min(1).max(12).default(4),
});

export const createAvailabilityRuleFn = createServerFn({ method: "POST" })
  .inputValidator((d) => ruleInput.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);
    if (data.endMinute <= data.startMinute) throw new Error("End time must be after the start time.");

    // Reuse a matching real session type for the unit, otherwise publish one.
    const { data: existing } = await db
      .from("appointment_types")
      .select("id")
      .eq("service_unit_id", data.unitId)
      .eq("name_en", data.serviceNameEn)
      .eq("duration_minutes", data.slotMinutes)
      .eq("is_demo_record", false)
      .maybeSingle();

    let typeId = existing?.id ?? null;
    if (!typeId) {
      const { data: created, error } = await db
        .from("appointment_types")
        .insert({
          service_unit_id: data.unitId,
          name_en: data.serviceNameEn,
          name_ar: data.serviceNameAr,
          duration_minutes: data.slotMinutes,
          location_type: data.location ? "in_person" : "online",
          is_active: true,
          data_source: "admin",
          is_demo_record: false,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      typeId = created.id;
    }

    const { data: rule, error: ruleError } = await db
      .from("staff_availability_rules")
      .insert({
        service_unit_id: data.unitId,
        staff_profile_id: data.staffProfileId,
        appointment_type_id: typeId,
        weekday: data.weekday,
        start_minute: data.startMinute,
        end_minute: data.endMinute,
        slot_minutes: data.slotMinutes,
        location: data.location,
        valid_from: data.validFrom,
        valid_to: data.validTo,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (ruleError) throw new Error(ruleError.message);

    await db.from("service_units").update({ appointment_enabled: true }).eq("id", data.unitId);
    const { data: created } = await db.rpc("generate_availability_slots", { _rule_id: rule.id, _weeks: data.weeks });
    return { ok: true, ruleId: rule.id, slotsCreated: Number(created ?? 0) };
  });

export const regenerateAvailabilityFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ruleId: z.string().uuid(), weeks: z.number().int().min(1).max(12).default(4) }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);
    const { data: created, error } = await db.rpc("generate_availability_slots", { _rule_id: data.ruleId, _weeks: data.weeks });
    if (error) throw new Error(error.message);
    return { ok: true, slotsCreated: Number(created ?? 0) };
  });

export const deactivateAvailabilityRuleFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ruleId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    await admin(db as never, context.userId);
    const { data: rule } = await db
      .from("staff_availability_rules")
      .select("appointment_type_id, staff_profile_id")
      .eq("id", data.ruleId)
      .maybeSingle();
    const { error } = await db.from("staff_availability_rules").update({ is_active: false }).eq("id", data.ruleId);
    if (error) throw new Error(error.message);
    // Withdraw future slots that nobody has booked; booked appointments stay.
    if (rule?.appointment_type_id) {
      await db
        .from("appointment_slots")
        .update({ status: "closed" })
        .eq("appointment_type_id", rule.appointment_type_id)
        .eq("status", "open")
        .eq("booked_count", 0)
        .gte("start_time", new Date().toISOString());
    }
    return { ok: true };
  });
