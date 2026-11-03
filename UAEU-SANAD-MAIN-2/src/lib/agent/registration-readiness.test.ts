import { describe, expect, it } from "vitest";
import {
  buildRegistrationReadinessReport,
  detectRegistrationReadinessIntent,
  findTimetableConflicts,
  humanizeStatus,
  parseMeetingSchedule,
  CREDIT_RULES,
} from "./registration-readiness.server";
import type { Db } from "./tools.server";

describe("Registration Readiness Agent — intent detection", () => {
  const yes = [
    "Am I ready to register?",
    "Can I register for next semester?",
    "What is blocking my registration?",
    "I can't register, why?",
    "registration eligibility check",
    "هل أستطيع التسجيل؟",
    "هل أنا جاهز للتسجيل؟",
    "ما الذي يمنعني من التسجيل؟",
    "لا أستطيع التسجيل",
  ];
  for (const q of yes) {
    it(`detects "${q}"`, () => {
      expect(detectRegistrationReadinessIntent(q)).toBe(true);
    });
  }

  const no = [
    "How many credits have I completed?",
    "Find me a book about machine learning",
    "The buses are always late",
    "كيف أطلب تصريح دخول للجامعة؟",
  ];
  for (const q of no) {
    it(`ignores "${q}"`, () => {
      expect(detectRegistrationReadinessIntent(q)).toBe(false);
    });
  }
});

describe("Registration Readiness Agent — timetable rules", () => {
  it("parses a readable meeting schedule", () => {
    expect(parseMeetingSchedule("Sun/Tue 10:00-11:15")).toEqual([
      { day: "sun", start: 600, end: 675 },
      { day: "tue", start: 600, end: 675 },
    ]);
  });

  it("returns null when the schedule cannot be read", () => {
    expect(parseMeetingSchedule("TBA")).toBeNull();
    expect(parseMeetingSchedule(null)).toBeNull();
  });

  it("finds an overlapping pair of sections", () => {
    const { conflicts } = findTimetableConflicts([
      { label: "CSCI305", schedule: "Sun/Tue 10:00-11:15" },
      { label: "MATH210", schedule: "Tue 11:00-12:15" },
      { label: "ELEC320", schedule: "Mon 09:00-10:15" },
    ]);
    expect(conflicts).toEqual([["CSCI305", "MATH210"]]);
  });

  it("reports unreadable schedules instead of guessing", () => {
    const { conflicts, unparsed } = findTimetableConflicts([
      { label: "CSCI305", schedule: "TBA" },
      { label: "MATH210", schedule: null },
    ]);
    expect(conflicts).toEqual([]);
    expect(unparsed).toEqual(["CSCI305", "MATH210"]);
  });
});

describe("Registration Readiness Agent — credit rules", () => {
  it("caps probation students below the normal maximum", () => {
    expect(CREDIT_RULES.maxOnProbation).toBeLessThan(CREDIT_RULES.maxPerTerm);
    expect(CREDIT_RULES.minPerTerm).toBeLessThanOrEqual(CREDIT_RULES.maxOnProbation);
  });
});

describe("Registration Readiness Agent — clean labels", () => {
  it("never exposes raw enum values", () => {
    expect(humanizeStatus("good_standing", false)).toBe("Good Standing");
    expect(humanizeStatus("good_standing", true)).toBe("وضع أكاديمي جيد");
    expect(humanizeStatus("active", false)).toBe("Active");
    expect(humanizeStatus("leave_of_absence", false)).toBe("Leave of Absence");
  });
});

/* ---------------- report tests with a stubbed database -------------- */

type TableData = { rows?: unknown[]; count?: number };

function mockDb(tables: Record<string, TableData>): Db {
  const chainFor = (entry: TableData): unknown => {
    const result = { data: entry.rows ?? [], count: entry.count ?? null, error: null };
    const self: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      maybeSingle: () => ({
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: (entry.rows ?? [])[0] ?? null, error: null }).then(res),
      }),
    };
    for (const m of ["select", "eq", "neq", "not", "gte", "lte", "in", "ilike", "order", "limit", "is"])
      self[m] = () => self;
    return self;
  };
  return { from: (t: string) => chainFor(tables[t] ?? { rows: [] }) } as unknown as Db;
}

const profile = (over: Record<string, unknown> = {}) => ({
  student_number: "202012345",
  program_id: "p1",
  account_status: "active",
  completed_credit_hours: 90,
  registered_credit_hours: 9,
  cumulative_gpa: 3.1,
  academic_standing: "good_standing",
  academic_level: "senior",
  expected_graduation_date: null,
  academic_programs: { code: "CE", name_en: "Computer Engineering", name_ar: "هندسة الحاسوب", total_credit_hours: 132, internship_minimum_credits: null },
  colleges: { name_en: "Engineering", name_ar: "الهندسة" },
  academic_terms: null,
  ...over,
});

const clashingEnrollments = [
  { enrollment_status: "enrolled", course_sections: { meeting_schedule: "Sun 10:00-11:00", courses: { id: "c1", code: "ETHC201", title_en: "Ethics", title_ar: "أخلاقيات", credit_hours: 3 }, academic_terms: null } },
  { enrollment_status: "enrolled", course_sections: { meeting_schedule: "Sun 10:30-11:30", courses: { id: "c2", code: "HIST120", title_en: "History", title_ar: "تاريخ", credit_hours: 3 }, academic_terms: null } },
];

const planCourse = { requirement_type: "major", recommended_year: 2, is_required: true, courses: { id: "c3", code: "CSCI101", title_en: "Intro CS", title_ar: "مدخل الحاسوب", credit_hours: 3 } };

function baseTables(over: Record<string, TableData> = {}): Record<string, TableData> {
  return {
    student_profiles: { rows: [profile()] },
    profiles: { rows: [{ full_name: "Test Student" }] },
    student_holds: { rows: [] },
    student_requirements: { rows: [] },
    cases: { rows: [], count: 0 },
    student_alerts: { rows: [], count: 0 },
    university_services: { rows: [] },
    academic_terms: { rows: [] }, // no window published
    student_course_history: { rows: [] },
    student_current_enrollments: { rows: clashingEnrollments },
    program_courses: { rows: [planCourse] },
    courses: { rows: [{ id: "c3", code: "CSCI101" }] },
    course_prerequisites: { rows: [] },
    ...over,
  };
}

describe("Registration Readiness Agent — report framing", () => {
  it("answers a hold question directly when no hold exists, then lists real issues", async () => {
    const report = await buildRegistrationReadinessReport(mockDb(baseTables()), "u1", "en", { holdQuestion: true });
    expect(report).not.toBeNull();
    const a = report!.answer;
    expect(a.startsWith("No registration hold was found on your record.")).toBe(true);
    expect(a).not.toMatch(/you have 1 active hold/i);
    expect(a).toContain("Timetable");
    expect(a).toContain("ETHC201");
    expect(a).toContain("9 credit hours");
    expect(a).toContain("Good Standing");
    expect(a).not.toContain("good_standing");
    expect(a).toContain("Other checks");
    // The only staff handover is the unpublished window, with the reason stated.
    expect(report!.proposals).toHaveLength(1);
    expect(report!.proposals[0]!.labelEn).toContain("confirm the registration window");
    expect(report!.proposals[0]!.args["unitCode"]).toBe("REG");
    expect(a).toContain("I can forward a request to Admission & Registration to confirm the registration window");
  });

  it("confirms a real blocking hold instead of denying it", async () => {
    const holds = [
      { title_en: "Unpaid tuition balance", title_ar: "رصيد غير مسدد", description_en: null, description_ar: null, resolution_action_en: "Pay at Finance.", resolution_action_ar: null, prevents_registration: true, prevents_graduation: false },
    ];
    const report = await buildRegistrationReadinessReport(mockDb(baseTables({ student_holds: { rows: holds } })), "u1", "en", { holdQuestion: true });
    expect(report!.answer).toContain("Yes — there is an active hold on your record that blocks registration.");
    expect(report!.answer).toContain("Unpaid tuition balance");
  });

  it("lists every hold when several block registration", async () => {
    const holds = [
      { title_en: "Unpaid tuition balance", title_ar: "قيد مالي", description_en: null, description_ar: null, resolution_action_en: null, resolution_action_ar: null, prevents_registration: true, prevents_graduation: false },
      { title_en: "Overdue library book", title_ar: "كتاب متأخر", description_en: null, description_ar: null, resolution_action_en: null, resolution_action_ar: null, prevents_registration: true, prevents_graduation: false },
    ];
    const report = await buildRegistrationReadinessReport(mockDb(baseTables({ student_holds: { rows: holds } })), "u1", "en");
    expect(report!.readiness.blockers.filter((c) => c.key === "holds")).toHaveLength(2);
    expect(report!.answer).toContain("Unpaid tuition balance");
    expect(report!.answer).toContain("Overdue library book");
  });

  it("reports Ready to Register with no issues and no staff handover", async () => {
    const tables = baseTables({
      student_profiles: { rows: [profile({ registered_credit_hours: 15 })] },
      student_current_enrollments: { rows: [] },
      academic_terms: {
        rows: [{ id: "t1", name_en: "Fall 2026", name_ar: "خريف 2026", registration_start: "2026-09-01", registration_end: "2026-09-30", add_drop_deadline: null, is_current: true }],
      },
    });
    const report = await buildRegistrationReadinessReport(mockDb(tables), "u1", "en", { holdQuestion: true });
    expect(report!.ready).toBe(true);
    expect(report!.answer).toContain("No registration hold was found on your record.");
    expect(report!.answer).toContain("**Ready to Register**");
    expect(report!.answer).not.toContain("Action Required");
    expect(report!.proposals).toHaveLength(0);
  });

  it("never claims an empty study plan unless it is verifiably complete", async () => {
    // Plan rows exist but reference no courses and no history exists: the
    // remainder cannot be verified, so nothing is claimed.
    const tables = baseTables({
      student_current_enrollments: { rows: [] },
      program_courses: { rows: [{ requirement_type: "major", recommended_year: 1, is_required: true, courses: null }] },
    });
    const report = await buildRegistrationReadinessReport(mockDb(tables), "u1", "en");
    expect(report!.answer).not.toContain("no remaining courses");
    expect(report!.answer).toContain("could not verify which plan courses remain");
  });

  it("answers in Arabic with clean labels", async () => {
    const report = await buildRegistrationReadinessReport(mockDb(baseTables()), "u1", "ar", { holdQuestion: true });
    const a = report!.answer;
    expect(a.startsWith("لم يتم العثور على أي قيد يمنع التسجيل في سجلك.")).toBe(true);
    expect(a).toContain("وضع أكاديمي جيد");
    expect(a).not.toContain("good_standing");
    expect(report!.proposals[0]!.labelAr).toContain("تأكيد فترة التسجيل");
  });
});
