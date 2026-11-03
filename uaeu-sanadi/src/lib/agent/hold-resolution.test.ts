import { describe, expect, it } from "vitest";
import {
  buildHoldCaseDescription,
  classifyHold,
  detectHoldResolutionIntent,
  formatHoldBlock,
  holdCaseMarker,
  type HoldDossier,
} from "./hold-resolution.server";
import type { StudentSnapshot } from "../student-context.server";

const hold = (over: Partial<HoldDossier> = {}): HoldDossier => ({
  holdId: "11111111-1111-1111-1111-111111111111",
  category: "financial",
  typeEn: "Financial hold",
  typeAr: "قيد مالي",
  rawType: "financial",
  titleEn: "Unpaid tuition balance",
  titleAr: "رصيد رسوم غير مسدد",
  reasonEn: "AED 4,200 outstanding for Spring 2026.",
  reasonAr: "مبلغ 4,200 درهم غير مسدد لفصل ربيع 2026.",
  actionEn: "Settle the balance at the Finance office or online.",
  actionAr: "سدد المبلغ لدى المالية أو عبر الإنترنت.",
  unitId: "unit-fin",
  unitCode: "FIN",
  unitNameEn: "Finance Department",
  unitNameAr: "الإدارة المالية",
  unitEmail: "finance@uni.ac.ae",
  unitPhone: "3311",
  unitUnknown: false,
  blocksRegistration: true,
  blocksGraduation: false,
  status: "active",
  issuedAt: "2026-02-01T00:00:00Z",
  expiresAt: null,
  existingCase: null,
  ...over,
});

const snapshot = {
  hasProfile: true,
  fullName: "Noura Al Ali",
  studentNumber: "202012345",
  programNameEn: "Computer Engineering",
  programNameAr: "هندسة الحاسوب",
  collegeNameEn: "College of Engineering",
  collegeNameAr: "كلية الهندسة",
  standing: "good_standing",
  gpa: 3.2,
  completedCredits: 90,
  totalCredits: 132,
} as unknown as StudentSnapshot;

describe("Hold Resolution Agent — intent", () => {
  const yes = [
    "Why can't I register?",
    "Do I have any holds on my account?",
    "How do I clear my financial hold?",
    "There is a restriction on my record",
    "هل يوجد قيد على سجلي؟",
    "كيف أزيل القيد المالي؟",
    "لماذا لا أستطيع التسجيل؟",
  ];
  for (const q of yes) it(`detects "${q}"`, () => expect(detectHoldResolutionIntent(q)).toBe(true));

  const no = ["When does the library close?", "كم ساعة أكملت؟", "Book me an advising appointment"];
  for (const q of no) it(`ignores "${q}"`, () => expect(detectHoldResolutionIntent(q)).toBe(false));
});

describe("Hold Resolution Agent — hold typing and ownership", () => {
  it("maps a financial hold to Finance", () => {
    const c = classifyHold("financial", "Unpaid tuition", "رسوم غير مسددة");
    expect(c.category).toBe("financial");
    expect(c.unitCode).toBe("FEES");
  });

  it("maps an Arabic library hold", () => {
    const c = classifyHold(null, "Overdue item", "كتاب متأخر من المكتبة");
    expect(c.category).toBe("library");
  });

  it("keeps an unknown hold explainable and routable, never guessed", () => {
    const c = classifyHold("xyz_unknown", "Special review", "مراجعة خاصة");
    expect(c.category).toBe("other");
    expect(c.unitCode).toBe("REG");
  });
});

describe("Hold Resolution Agent — student-facing block", () => {
  it("shows type, reason, unit, action, contact and status in English", () => {
    const out = formatHoldBlock(hold(), "en", 1);
    expect(out).toContain("Hold type: Financial hold");
    expect(out).toContain("Reason: AED 4,200");
    expect(out).toContain("Responsible unit: Finance Department");
    expect(out).toContain("What you need to do: Settle the balance");
    expect(out).toContain("finance@uni.ac.ae");
    expect(out).toContain("Status: Active (blocks registration)");
  });

  it("renders the same fields in Arabic", () => {
    const out = formatHoldBlock(hold(), "ar", 2);
    expect(out).toContain("النوع: قيد مالي");
    expect(out).toContain("الجهة المسؤولة: الإدارة المالية");
    expect(out).toContain("المطلوب منك");
    expect(out).toContain("الحالة: نشط");
  });

  it("says plainly when the responsible unit is missing instead of inventing one", () => {
    const out = formatHoldBlock(
      hold({ unitId: null, unitCode: null, unitNameEn: null, unitNameAr: null, unitEmail: null, unitPhone: null, unitUnknown: true }),
      "en",
      1,
    );
    expect(out).toContain("not recorded");
    expect(out).toContain("Admission & Registration");
  });

  it("flags an inferred owner rather than presenting it as confirmed", () => {
    const out = formatHoldBlock(hold({ unitUnknown: true }), "en", 1);
    expect(out).toContain("likely owner");
  });

  it("offers no invented step when none is recorded", () => {
    const out = formatHoldBlock(hold({ actionEn: null, actionAr: null }), "en", 1);
    expect(out).toContain("No specific step is recorded");
  });

  it("shows the tracked resolution case when one exists", () => {
    const out = formatHoldBlock(
      hold({
        existingCase: {
          caseId: "case-1",
          reference: "CASE-2026-0042",
          status: "assigned",
          createdAt: "2026-03-01T00:00:00Z",
          open: true,
          trackingUrl: "/requests/case-1",
        },
      }),
      "en",
      1,
    );
    expect(out).toContain("CASE-2026-0042");
    expect(out).toContain("Assigned to staff");
  });
});

describe("Hold Resolution Agent — Ask Once case context", () => {
  it("attaches identity, programme and hold detail so nothing is re-asked", () => {
    const body = buildHoldCaseDescription(hold(), snapshot, "en");
    expect(body).toContain("Noura Al Ali");
    expect(body).toContain("202012345");
    expect(body).toContain("Computer Engineering");
    expect(body).toContain("Unpaid tuition balance");
    expect(body).toContain("90/132");
    expect(body).toContain(holdCaseMarker(hold().holdId));
  });

  it("tells the unit when the hold has no recorded owner", () => {
    const body = buildHoldCaseDescription(hold({ unitUnknown: true }), snapshot, "en");
    expect(body).toContain("Issuing unit is not recorded");
  });

  it("writes the case in Arabic for an Arabic conversation", () => {
    const body = buildHoldCaseDescription(hold(), snapshot, "ar");
    expect(body).toContain("طلب رفع قيد");
    expect(body).toContain("هندسة الحاسوب");
  });
});
