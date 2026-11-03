import { publishableEmail } from "./contact-safety";
/**
 * Campus services directory — the student-facing list of university units,
 * what each one handles, how to contact it and whether it currently publishes
 * appointment availability. Everything comes from the same records the
 * Assistant uses, so a unit is never described from invented information.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DirectoryService = {
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  category: string | null;
};

export type DirectoryUnit = {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  email: string | null;
  phoneExtension: string | null;
  officeEn: string | null;
  officeAr: string | null;
  hoursEn: string | null;
  hoursAr: string | null;
  services: DirectoryService[];
  openSlots: number;
  nextSlot: string | null;
};

/** Every active unit a student can be routed to, with its published contact details. */
export const getCampusDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const [unitsRes, servicesRes, slotsRes] = await Promise.all([
      supabase
        .from("service_units")
        .select(
          "id, code, name_en, name_ar, description_en, description_ar, email, contact_email, phone_extension, office_location_en, office_location_ar, service_hours_en, service_hours_ar",
        )
        .eq("is_active", true)
        .order("name_en"),
      supabase
        .from("university_services")
        .select("code, name_en, name_ar, description_en, description_ar, category, service_unit_id")
        .eq("is_active", true)
        .order("name_en"),
      supabase.rpc("list_appointment_availability", { _limit: 200 }),
    ]);

    const availability = new Map<string, { count: number; next: string | null }>();
    for (const row of (slotsRes.data ?? []) as { unit_id: string | null; start_time: string }[]) {
      if (!row.unit_id) continue;
      const entry = availability.get(row.unit_id) ?? { count: 0, next: null };
      entry.count += 1;
      if (!entry.next || row.start_time < entry.next) entry.next = row.start_time;
      availability.set(row.unit_id, entry);
    }

    const units: DirectoryUnit[] = (unitsRes.data ?? []).map((u) => {
      const services = (servicesRes.data ?? [])
        .filter((s) => s.service_unit_id === u.id)
        .map((s) => ({
          code: s.code,
          nameEn: s.name_en,
          nameAr: s.name_ar,
          descriptionEn: s.description_en,
          descriptionAr: s.description_ar,
          category: s.category,
        }));
      const slots = availability.get(u.id);
      return {
        id: u.id,
        code: u.code,
        nameEn: u.name_en,
        nameAr: u.name_ar,
        descriptionEn: u.description_en,
        descriptionAr: u.description_ar,
        email: publishableEmail(u.contact_email, u.email),
        phoneExtension: u.phone_extension,
        officeEn: u.office_location_en,
        officeAr: u.office_location_ar,
        hoursEn: u.service_hours_en,
        hoursAr: u.service_hours_ar,
        services,
        openSlots: slots?.count ?? 0,
        nextSlot: slots?.next ?? null,
      };
    });

    // Units a student can actually contact or transact with come first; the
    // remaining internal units stay listed but clearly have no published contact.
    const score = (u: DirectoryUnit) => (u.openSlots ? 0 : u.services.length ? 1 : u.email ? 2 : 3);
    units.sort((a, b) => score(a) - score(b) || a.nameEn.localeCompare(b.nameEn));

    return { units, generatedAt: new Date().toISOString() };
  });
