import { describe, expect, it } from "vitest";
import { heuristicClassify } from "@/lib/routing/intent";
import { parseSearchIntent } from "@/lib/library/provider.server";
import { requirementLabel } from "@/lib/transfer/labels";
import { contentFieldLabel } from "@/lib/field-label";
import { CATEGORY_LABEL, STUDENT_NOTIFICATION_TABS } from "@/lib/notifications/student-categories";

describe("Arabic localization", () => {
  it("Arabic hostel request routes to hostel booking", () => {
    expect(heuristicClassify("أبغي أحجز غرفة في السكن").intent).toBe("hostel_booking");
  });
  it("Arabic transfer request routes to programme transfer", () => {
    expect(heuristicClassify("أبغي أحول تخصصي إلى علوم الحاسوب").intent).toBe("program_transfer");
  });
  it("transfer requirement names are Arabic in Arabic UI, never raw codes", () => {
    expect(requirementLabel("high_school", true)).toBe("نسبة الثانوية");
    expect(requirementLabel("gpa", true)).toBe("المعدل");
    expect(requirementLabel("some_new_rule", true)).not.toMatch(/[a-z_]/);
  });
  it("Arabic library request extracts topic, type, availability and fields", () => {
    const p = parseSearchIntent("ابحث لي عن كتب متاحة عن تعلم الآلة وأظهر المؤلف ورابط الفهرس.");
    expect([p.query, p.types, p.availableOnly, p.requestedFields]).toEqual([
      "machine learning", ["book"], true, ["author", "catalogue_link"],
    ]);
  });
  it("mixed Arabic/English library request", () => {
    expect(parseSearchIntent("find كتب عن الذكاء الاصطناعي").query).toBe("artificial intelligence");
  });
  it("notification tabs and categories have Arabic labels", () => {
    for (const t of STUDENT_NOTIFICATION_TABS) expect(t.ar).toMatch(/[\u0600-\u06FF]/);
    for (const c of Object.values(CATEGORY_LABEL)) expect(c.ar).toMatch(/[\u0600-\u06FF]/);
  });
  it("bilingual admin fields never show (EN)/(AR) codes", () => {
    expect(contentFieldLabel("Title", "العنوان", "en", true)).toBe("العنوان بالإنجليزية");
    expect(contentFieldLabel("Title", "العنوان", "ar", false)).toBe("Title (Arabic)");
    expect(contentFieldLabel("Title", "العنوان", "en", true)).not.toContain("(EN)");
  });
});

import { arabicNotificationBody } from "@/lib/notifications/student-categories";
describe("Arabic notification wording", () => {
  it.each([
    ["appointment_booked", { when: "Monday 21 September 9:00 AM", staff_name: "Amna" }, "تم تأكيد الموعد"],
    ["case_status_changed", {}, "تم تحديث حالة الطلب"],
    ["information_requested", {}, "مطلوب معلومات إضافية"],
    ["document_ready", {}, "جاهزة للعرض والتنزيل"],
    ["case_resolved", {}, "تم حل الطلب"],
    ["sla_overdue", {}, "تجاوز موعده النهائي"],
  ])("%s", (type, payload, expected) => {
    const b = arabicNotificationBody(type, payload, "UAEU-2026-01083");
    expect(b).toContain(expected);
    if (type !== "appointment_booked") expect(b).toContain("UAEU-2026-01083");
  });
});
