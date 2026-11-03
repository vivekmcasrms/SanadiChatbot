/**
 * Campus services directory — the student-facing list of university units,
 * what each one handles, how to contact it and whether it currently publishes
 * appointment availability. Everything comes from the same records the
 * Assistant uses, so a unit is never described from invented information.
 */
import { apiFetch } from "@/lib/auth-token";

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
export async function getCampusDirectory(): Promise<{ units: DirectoryUnit[]; generatedAt: string }> {
  return apiFetch("/api/directory");
}
