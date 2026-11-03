import { describe, it, expect } from "vitest";
import { matchEmergency } from "./emergency.server";
const rows = [
  { id: "1", code: "LOST", category_en: "Lost and Found", category_ar: null, emergency_type_en: "Lost property", emergency_type_ar: null, responsible_unit_en: "Security", responsible_unit_ar: null, label_en: null, label_ar: null, mobile_number: "0500000000", emergency_number: null, email: null, notes_en: null, notes_ar: null, keywords: ["lost", "missing", "stolen", "wallet"], priority: 10 },
  { id: "2", code: "FIRE", category_en: "Fire", category_ar: null, emergency_type_en: "Fire", emergency_type_ar: null, responsible_unit_en: "Safety", responsible_unit_ar: null, label_en: null, label_ar: null, mobile_number: null, emergency_number: "999", email: null, notes_en: null, notes_ar: null, keywords: ["fire", "smoke"], priority: 1 },
];
const db = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ data: rows }) }) }) }) } as never;
describe("emergency", () => {
  it("skills question is not lost property", async () => {
    expect(await matchEmergency(db, "What skills am I missing?", { activeDomain: "career" })).toBeNull();
    expect(await matchEmergency(db, "What skills am I missing?")).toBeNull();
  });
  it("lost wallet routes to security", async () => {
    const m = await matchEmergency(db, "I lost my wallet on campus", { activeDomain: null });
    expect(m?.record.code).toBe("LOST");
  });
  it("lost wallet near a named location still routes to security", async () => {
    const m = await matchEmergency(db, "I lost my wallet on campus near the library", { activeDomain: null });
    expect(m?.record.code).toBe("LOST");
  });
  it("fire routes to emergency even mid-conversation", async () => {
    const m = await matchEmergency(db, "There is a fire", { activeDomain: "career" });
    expect(m?.record.code).toBe("FIRE");
  });
});
