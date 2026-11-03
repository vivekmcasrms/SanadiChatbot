/**
 * Central service-availability mechanism. Server only.
 *
 * Every service module must ask this module whether a service is currently
 * open before running eligibility, analysis or transactional workflows.
 * All decisions come from `public.get_service_availability` (UAE time),
 * never from the browser clock.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Lang } from "../agent-types";
import {
  SERVICE_CODES,
  UNIVERSITY_TIMEZONE,
  type AvailabilityStatus,
  type ServiceAvailability,
  type ServiceKey,
} from "./availability-types";
import { availabilityChip, availabilityMessage, availabilityWindowLabel, formatUae } from "./availability-format";

export type Db = SupabaseClient<Database>;

export { SERVICE_CODES, UNIVERSITY_TIMEZONE, availabilityChip, availabilityMessage, availabilityWindowLabel, formatUae };
export type { AvailabilityStatus, ServiceAvailability, ServiceKey };

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

function normalize(raw: Raw): ServiceAvailability {
  const status = (s(raw["status"]) ?? "closed") as AvailabilityStatus;
  return {
    serviceId: s(raw["service_id"]),
    serviceCode: s(raw["service_code"]),
    serviceNameEn: s(raw["service_name_en"]),
    serviceNameAr: s(raw["service_name_ar"]),
    exists: raw["exists"] === true,
    isAvailable: raw["is_available"] === true,
    status,
    availabilityType: s(raw["availability_type"]) ?? "always_available",
    currentWindowId: s(raw["current_window_id"]),
    nextWindowId: s(raw["next_window_id"]),
    opensAt: s(raw["opens_at"]),
    closesAt: s(raw["closes_at"]),
    nextOpenAt: s(raw["next_open_at"]),
    nextCloseAt: s(raw["next_close_at"]),
    reasonEn: s(raw["reason_en"]),
    reasonAr: s(raw["reason_ar"]),
    studentMessageEn: s(raw["student_message_en"]),
    studentMessageAr: s(raw["student_message_ar"]),
    remindersEnabled: raw["reminders_enabled"] === true,
    preliminaryCheckAllowed: raw["preliminary_check_allowed"] === true,
    timezone: s(raw["timezone"]) ?? UNIVERSITY_TIMEZONE,
  };
}

const unknownService = (code: string): ServiceAvailability => ({
  serviceId: null,
  serviceCode: code,
  serviceNameEn: null,
  serviceNameAr: null,
  exists: false,
  // A service that has no catalogue record must not block existing flows.
  isAvailable: true,
  status: "always_available",
  availabilityType: "always_available",
  currentWindowId: null,
  nextWindowId: null,
  opensAt: null,
  closesAt: null,
  nextOpenAt: null,
  nextCloseAt: null,
  reasonEn: null,
  reasonAr: null,
  studentMessageEn: null,
  studentMessageAr: null,
  remindersEnabled: false,
  preliminaryCheckAllowed: false,
  timezone: UNIVERSITY_TIMEZONE,
});

/** Availability for a service id. */
export async function getServiceAvailabilityById(db: Db, serviceId: string): Promise<ServiceAvailability> {
  const { data, error } = await db.rpc("get_service_availability", { _service_id: serviceId });
  if (error || !data) return unknownService(serviceId);
  return normalize(data as Raw);
}

/** Availability for a service code, e.g. SVC-COLLEGE-TRANSFER. */
export async function getServiceAvailability(db: Db, code: string): Promise<ServiceAvailability> {
  const { data } = await db.from("university_services").select("id").eq("code", code).maybeSingle();
  if (!data?.id) return unknownService(code);
  return getServiceAvailabilityById(db, data.id);
}

export const availabilityFor = (db: Db, key: ServiceKey) => getServiceAvailability(db, SERVICE_CODES[key]);

/**
 * Guard for service workflows. Returns null when the service may proceed,
 * otherwise a student-friendly blocking payload.
 */
export async function requireServiceOpen(
  db: Db,
  code: string,
  lang: Lang,
): Promise<{ availability: ServiceAvailability; blocked: null | { message: string; canRequestReminder: boolean; preliminaryAllowed: boolean } }> {
  const availability = await getServiceAvailability(db, code);
  if (availability.isAvailable) return { availability, blocked: null };
  return {
    availability,
    blocked: {
      message: availabilityMessage(availability, lang),
      canRequestReminder: availability.remindersEnabled && !!availability.nextOpenAt,
      preliminaryAllowed: availability.preliminaryCheckAllowed,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

export async function createServiceReminder(
  db: Db,
  userId: string,
  code: string,
  reminderType: "service_open" | "day_before_open" = "service_open",
) {
  const availability = await getServiceAvailability(db, code);
  if (!availability.serviceId) throw new Error("Unknown service.");
  if (availability.isAvailable) throw new Error("SERVICE_ALREADY_OPEN");
  if (!availability.nextOpenAt || !availability.remindersEnabled) throw new Error("REMINDERS_UNAVAILABLE");

  const openAt = new Date(availability.nextOpenAt);
  const scheduledFor =
    reminderType === "day_before_open" ? new Date(openAt.getTime() - 86_400_000).toISOString() : openAt.toISOString();

  const { data: existing } = await db
    .from("student_service_reminders")
    .select("id")
    .eq("student_id", userId)
    .eq("service_id", availability.serviceId)
    .eq("reminder_type", reminderType)
    .eq("status", "scheduled")
    .maybeSingle();
  if (existing?.id) return { id: existing.id, scheduledFor, alreadyExisted: true, availability };

  const { data, error } = await db
    .from("student_service_reminders")
    .insert({
      student_id: userId,
      service_id: availability.serviceId,
      availability_window_id: availability.nextWindowId,
      reminder_type: reminderType,
      scheduled_for: scheduledFor,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, scheduledFor, alreadyExisted: false, availability };
}

export async function cancelServiceReminder(db: Db, userId: string, reminderId: string) {
  const { error } = await db
    .from("student_service_reminders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", reminderId)
    .eq("student_id", userId)
    .eq("status", "scheduled");
  if (error) throw error;
  return { ok: true };
}

export async function listMyServiceReminders(db: Db, userId: string) {
  const { data } = await db
    .from("student_service_reminders")
    .select("id, service_id, reminder_type, scheduled_for, status, sent_at, university_services(code, name_en, name_ar)")
    .eq("student_id", userId)
    .order("scheduled_for", { ascending: true })
    .limit(50);
  return data ?? [];
}
