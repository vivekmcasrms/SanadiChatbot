import { describe, expect, it } from "vitest";
import {
  buildAppointmentReport,
  detectAppointmentIntent,
  dubaiParts,
  filterByPreference,
  listAppointmentServices,
  matchAppointmentService,
  matchOfferedSlots,
  parseSlotSelection,
  pickOfferedSlot,
  type AvailableSlot,
} from "./appointment.server";
import type { Db } from "./tools.server";

const NOW = new Date("2026-03-01T06:00:00Z"); // Sunday 10:00 Dubai

/** Dubai wall clock -> UTC instant. */
function dubai(day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(2026, 2, day, hour, minute) - 4 * 3600_000).toISOString();
}

function slotRow(id: string, startIso: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    slot_id: id,
    start_time: startIso,
    end_time: new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString(),
    seats_left: 2,
    type_id: "t1",
    type_name_en: "Career counselling",
    type_name_ar: "إرشاد مهني",
    duration_minutes: 30,
    location_type: "in_person",
    location: "Building F1, Room 210",
    meeting_link: null,
    requires_approval: false,
    unit_id: "u1",
    unit_code: "CAREER",
    unit_name_en: "Career Services",
    unit_name_ar: "خدمات التوظيف",
    unit_email: "career@uaeu.ac.ae",
    staff_id: "staff-1",
    staff_name: "Mariam Al Ali",
    staff_email: "mariam@uaeu.ac.ae",
    ...extra,
  };
}

function appointmentRow(extra: Partial<Record<string, unknown>> = {}) {
  return {
    appointment_id: "appt-1",
    slot_id: "s-old",
    status: "confirmed",
    confirmation_code: "APT-2026-001",
    purpose: null,
    start_time: dubai(4, 11),
    end_time: dubai(4, 11, 30),
    type_name_en: "Career counselling",
    type_name_ar: "إرشاد مهني",
    location_type: "in_person",
    location: "Building F1, Room 210",
    meeting_link: null,
    unit_code: "CAREER",
    unit_name_en: "Career Services",
    unit_name_ar: "خدمات التوظيف",
    unit_email: "career@uaeu.ac.ae",
    staff_name: "Mariam Al Ali",
    staff_email: "mariam@uaeu.ac.ae",
    ...extra,
  };
}

function fakeDb(opts: { slots?: unknown[]; appointments?: unknown[] }): Db {
  return {
    rpc: async (name: string) => {
      if (name === "list_appointment_availability") return { data: opts.slots ?? [], error: null };
      if (name === "my_appointments") return { data: opts.appointments ?? [], error: null };
      return { data: null, error: null };
    },
  } as unknown as Db;
}

const slot = (id: string, startIso: string): AvailableSlot => ({
  slotId: id,
  start: startIso,
  end: startIso,
  seatsLeft: 1,
  typeId: null,
  typeNameEn: "Career counselling",
  typeNameAr: "إرشاد مهني",
  durationMinutes: 30,
  locationType: "in_person",
  location: "F1-210",
  meetingLink: null,
  requiresApproval: false,
  unitId: "u1",
  unitCode: "CAREER",
  unitNameEn: "Career Services",
  unitNameAr: "خدمات التوظيف",
  unitEmail: null,
  staffId: "staff-1",
  staffName: "Mariam Al Ali",
  staffEmail: null,
});

describe("appointment intent detection", () => {
  it("recognises an English booking request with unit and time preference", () => {
    const intent = detectAppointmentIntent("I want to meet a career counsellor tomorrow afternoon", NOW);
    expect(intent?.action).toBe("book");
    expect(intent?.unitCode).toBe("CAREER");
    expect(intent?.partOfDay).toBe("afternoon");
    expect(dubaiParts(intent!.from).day).toBe(2);
  });

  it("recognises an Arabic booking request", () => {
    const intent = detectAppointmentIntent("أريد حجز موعد مع المرشد المهني غداً", NOW);
    expect(intent?.action).toBe("book");
    expect(intent?.unitCode).toBe("CAREER");
    expect(intent?.explicitDay).toBe(true);
  });

  it("recognises listing, cancelling and rescheduling", () => {
    expect(detectAppointmentIntent("show me my appointments", NOW)?.action).toBe("list");
    expect(detectAppointmentIntent("مواعيدي", NOW)?.action).toBe("list");
    expect(detectAppointmentIntent("cancel my appointment", NOW)?.action).toBe("cancel");
    expect(detectAppointmentIntent("ألغ موعدي", NOW)?.action).toBe("cancel");
    expect(detectAppointmentIntent("can I reschedule my appointment?", NOW)?.action).toBe("reschedule");
    expect(detectAppointmentIntent("أريد تأجيل موعدي", NOW)?.action).toBe("reschedule");
  });

  it("ignores messages that are not about appointments", () => {
    expect(detectAppointmentIntent("what is my GPA?", NOW)).toBeNull();
  });

  it("resolves next week as a forward window", () => {
    const intent = detectAppointmentIntent("book an appointment next week", NOW)!;
    expect(new Date(intent.from).getTime()).toBeGreaterThan(NOW.getTime());
    expect(new Date(intent.to).getTime()).toBeGreaterThan(new Date(intent.from).getTime());
  });
});

describe("preference filtering and slot selection", () => {
  it("keeps only afternoon slots when the afternoon was requested", () => {
    const intent = detectAppointmentIntent("appointment tomorrow afternoon", NOW)!;
    const slots = [slot("a", dubai(2, 9)), slot("b", dubai(2, 14)), slot("c", dubai(2, 16))];
    expect(filterByPreference(slots, intent).map((s) => s.slotId)).toEqual(["b", "c"]);
  });

  it("matches a spoken time against the offered slots only", () => {
    const offered = [slot("a", dubai(2, 14)), slot("b", dubai(2, 15)), slot("c", dubai(2, 16, 30))];
    expect(parseSlotSelection("3 PM", offered)?.slotId).toBe("b");
    expect(parseSlotSelection("الساعة 2 مساءً", offered)?.slotId).toBe("a");
    expect(parseSlotSelection("the second one", offered)?.slotId).toBe("b");
    expect(parseSlotSelection("9 am", offered)).toBeNull();
  });

  it("resolves a displayed option number straight to that slot", () => {
    const offered = [
      slot("a", dubai(2, 9)),
      slot("b", dubai(2, 9)),
      slot("c", dubai(2, 10)),
      slot("d", dubai(2, 11)),
    ];
    expect(parseSlotSelection("1", offered)?.slotId).toBe("a");
    expect(parseSlotSelection("Option 2", offered)?.slotId).toBe("b");
    expect(parseSlotSelection("Book number 3", offered)?.slotId).toBe("c");
    expect(parseSlotSelection("I'll take 4", offered)?.slotId).toBe("d");
    expect(parseSlotSelection("الخيار 2", offered)?.slotId).toBe("b");
    expect(parseSlotSelection("٣", offered)?.slotId).toBe("c");
    // The whole pasted option line still resolves to that option, not to a
    // fuzzy time or advisor match.
    expect(
      parseSlotSelection("1. Monday 21 September · 10:00 AM Dalal Al Maamari", offered)?.slotId,
    ).toBe("a");
    // An option number outside the displayed list is not a selection.
    expect(parseSlotSelection("9", offered)).toBeNull();
  });



  it("does not treat a library follow-up as a slot selection", () => {
    const offered = [slot("a", dubai(2, 14)), slot("b", dubai(2, 15))];
    // "the first one" refers to the first BOOK in a library conversation,
    // not the first offered appointment slot.
    expect(pickOfferedSlot("Is the first one available online?", offered, "library")).toBeNull();
    expect(pickOfferedSlot("Where can I find the second one?", offered, "library")).toBeNull();
    // Inside the appointment flow the same ordinals still select a slot.
    expect(pickOfferedSlot("the first one", offered, "appointments")?.slotId).toBe("a");
    expect(pickOfferedSlot("the second one", offered, null)?.slotId).toBe("b");
  });

  it("does not detect an appointment in a library availability follow-up", () => {
    expect(detectAppointmentIntent("Is the first one available online?", NOW)).toBeNull();
    expect(detectAppointmentIntent("Where can I find it in the library?", NOW)).toBeNull();
  });
});

describe("appointment agent report", () => {
  it("offers real slots for a booking request in English", async () => {
    const db = fakeDb({ slots: [slotRow("s1", dubai(2, 14)), slotRow("s2", dubai(2, 15))] });
    const intent = detectAppointmentIntent("I want to meet a career counsellor tomorrow afternoon", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.action).toBe("book");
    expect(report.offeredSlots).toHaveLength(2);
    expect(report.answer).toContain("Mariam Al Ali");
    expect(report.answer).toContain("Building F1, Room 210");
  });

  it("answers in Arabic when the student uses Arabic", async () => {
    const db = fakeDb({ slots: [slotRow("s1", dubai(2, 14))] });
    const intent = detectAppointmentIntent("أريد حجز موعد مع المرشد المهني غداً بعد الظهر", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "ar", intent);
    expect(report.answer).toMatch(/[\u0600-\u06FF]/);
    expect(report.offeredSlots).toHaveLength(1);
    expect(report.proposals[0]?.toolName).toBe("book_appointment");
  });

  it("never invents a time when nothing is open", async () => {
    const db = fakeDb({ slots: [] });
    const intent = detectAppointmentIntent("book an appointment with a career counsellor tomorrow", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.offeredSlots).toHaveLength(0);
    // No invented time: a real routed meeting request is offered instead.
    expect(report.proposals[0]?.toolName).toBe("escalate_to_human");
    expect(report.answer.toLowerCase()).toContain("not yet been configured");
  });

  it("warns instead of creating a duplicate booking with the same unit", async () => {
    const db = fakeDb({ slots: [slotRow("s1", dubai(3, 14))], appointments: [appointmentRow()] });
    const intent = detectAppointmentIntent("book me a career appointment", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.answer).toContain("already have an upcoming appointment");
    expect(report.upcoming).toHaveLength(1);
  });

  it("shows the booked appointment with staff, place and code", async () => {
    const db = fakeDb({ appointments: [appointmentRow()] });
    const intent = detectAppointmentIntent("what are my appointments?", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.answer).toContain("APT-2026-001");
    expect(report.answer).toContain("Career Services");
    expect(report.state.upcoming[0]?.appointmentId).toBe("appt-1");
  });

  it("proposes a cancellation against the real appointment", async () => {
    const db = fakeDb({ appointments: [appointmentRow()] });
    const intent = detectAppointmentIntent("cancel my appointment", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.proposals[0]).toEqual({
      toolName: "cancel_appointment",
      args: { appointmentId: "appt-1" },
    });
  });

  it("offers alternative slots when rescheduling", async () => {
    const db = fakeDb({
      slots: [slotRow("s-new", dubai(5, 15))],
      appointments: [appointmentRow()],
    });
    const intent = detectAppointmentIntent("reschedule my appointment to next week", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.action).toBe("reschedule");
    expect(report.offeredSlots.map((s) => s.slotId)).toEqual(["s-new"]);
    expect(report.state.offeredSlots).toHaveLength(1);
  });

  it("says so plainly when there is nothing to cancel", async () => {
    const db = fakeDb({ appointments: [] });
    const intent = detectAppointmentIntent("cancel my appointment", NOW)!;
    const report = await buildAppointmentReport(db, "student-1", "en", intent);
    expect(report.proposals).toHaveLength(0);
    expect(report.answer).toContain("no upcoming appointment");
  });
});

describe("slot list formatting", () => {
  it("numbers five offered slots 1-5 without markdown list markers", async () => {
    const { formatSlotLine } = await import("./appointment.server");
    const slots = ["a", "b", "c", "d", "e"].map((id, i) => slot(id, dubai(2, 9 + i)));
    const answer = slots.map((s, i) => formatSlotLine(s, "en", i + 1)).join("\n");
    for (const n of [1, 2, 3, 4, 5]) {
      expect(answer).toContain(`**${n}.**`);
    }
    // No bare ordered-list markers that a markdown renderer could restart.
    expect(answer).not.toMatch(/^1\. /m);
    // Consistent AM/PM capitalisation.
    expect(answer).toContain("AM");
    expect(answer).not.toMatch(/\d am\b/);
    // Advisor, service, duration and location are present and aligned.
    expect(answer).toContain("Mariam Al Ali");
    expect(answer).toContain("Career counselling · 30 min");
    expect(answer).toContain("F1-210");
  });

  it("renames Career and Internship Services to Career Counselling", async () => {
    const { formatSlotLine } = await import("./appointment.server");
    const s = { ...slot("x", dubai(2, 9)), unitNameEn: "Career and Internship Services" };
    const line = formatSlotLine(s, "en", 1);
    expect(line).not.toContain("Internship");
  });
});

describe("slot selection by advisor or service wording", () => {
  const offers = () => [
    { ...slot("slot-a", dubai(2, 9)), staffName: "Hamad Advisor", typeName: "Academic Advising", unit: "Academic Advising" },
    { ...slot("slot-b", dubai(2, 11)), staffName: "Amna Al Dhaheri", typeName: "جلسة إرشاد مهني", unit: "Career Counselling" },
  ];

  it("picks the offered slot named by the advisor", async () => {
    const { parseSlotSelection } = await import("./appointment.server");
    expect(parseSlotSelection("أريد الموعد مع Amna", offers())?.slotId).toBe("slot-b");
    expect(parseSlotSelection("the one with Hamad please", offers())?.slotId).toBe("slot-a");
  });

  it("picks the offered slot named by the service type", async () => {
    const { parseSlotSelection } = await import("./appointment.server");
    expect(parseSlotSelection("جلسة إرشاد مهني", offers())?.slotId).toBe("slot-b");
  });

  it("never guesses when the wording matches several offers or none", async () => {
    const { parseSlotSelection } = await import("./appointment.server");
    const two = [
      { ...slot("s1", dubai(2, 9)), staffName: "Amna Al Dhaheri", unit: "Career Counselling" },
      { ...slot("s2", dubai(2, 10)), staffName: "Sara Al Ali", unit: "Career Counselling" },
    ];
    // "Career" matches both offers -> ambiguous -> no guess.
    expect(parseSlotSelection("career", two)).toBeNull();
    expect(parseSlotSelection("كلام لا يخص أي موعد", offers())).toBeNull();
  });

  it("still honours pickOfferedSlot domain anchoring for named selection", async () => {
    const { pickOfferedSlot } = await import("./appointment.server");
    expect(pickOfferedSlot("جلسة إرشاد مهني", offers(), "appointments")?.slotId).toBe("slot-b");
    expect(pickOfferedSlot("جلسة إرشاد مهني", offers(), "library")).toBeNull();
  });
});

type Offered = {
  slotId: string;
  start: string;
  staffName?: string | null;
  unit?: string | null;
  typeName?: string | null;
};

describe("ambiguous service wording across several offered slots", () => {
  const career = (
    slotId: string,
    staffName: string,
    start = "2026-09-14T05:00:00+00:00",
  ): Offered => ({
    slotId,
    start,
    staffName,
    unit: "خدمات المهن والتدريب",
    typeName: "جلسة إرشاد مهني",
  });

  it("ranks the fully matching session type above partial matches", () => {
    const offered: Offered[] = [
      { slotId: "slot-a", start: "2026-09-14T05:00:00+00:00", staffName: "Khalid Al Shamsi", unit: "الإرشاد الأكاديمي", typeName: "جلسة إرشاد أكاديمي" },
      career("slot-b", "Amna Al Dhaheri"),
      career("slot-c", "Dalal Al Maamari"),
    ];
    const matches = matchOfferedSlots("جلسة إرشاد مهني", offered);
    expect(matches.map((m) => m.slotId).sort()).toEqual(["slot-b", "slot-c"]);
    expect(parseSlotSelection("جلسة إرشاد مهني", offered)).toBeNull();
  });

  it("resolves once the reply also names the advisor", () => {
    const offered: Offered[] = [career("slot-b", "Amna Al Dhaheri"), career("slot-c", "Dalal Al Maamari")];
    expect(parseSlotSelection("جلسة إرشاد مهني مع Dalal", offered)?.slotId).toBe("slot-c");
  });

  it("normalizes the Arabic definite article when matching", () => {
    const offered: Offered[] = [career("slot-b", "Amna Al Dhaheri")];
    expect(parseSlotSelection("الإرشاد المهني", offered)?.slotId).toBe("slot-b");
  });
});

describe("service clarification before searching", () => {
  const mixed = [
    slotRow("s1", dubai(9, 9)),
    slotRow("s2", dubai(9, 10), {
      unit_code: "ADV",
      unit_name_en: "Academic Advising",
      unit_name_ar: "الإرشاد الأكاديمي",
      type_name_en: "Academic advising",
      type_name_ar: "إرشاد أكاديمي",
    }),
    slotRow("s3", dubai(9, 11), {
      unit_code: "ACCESS",
      unit_name_en: "Accessibility Support",
      unit_name_ar: "دعم ذوي الهمم",
      type_name_en: "Accessibility support",
      type_name_ar: "دعم الوصول",
    }),
  ];

  it("asks which service instead of mixing unrelated units", async () => {
    const intent = detectAppointmentIntent("Can you book me the earliest available appointment next week?", NOW)!;
    expect(intent.unitCode).toBeNull();
    expect(intent.anyService).toBe(false);
    const report = await buildAppointmentReport(fakeDb({ slots: mixed }), "u", "en", intent);
    expect(report.answer).toContain("Which service");
    expect(report.answer).toContain("Academic Advising");
    expect(report.answer).toContain("Accessibility Support");
    expect(report.offeredSlots).toHaveLength(0);
    expect(report.state.awaitingService).toBe(true);
    expect(report.state.serviceOptions?.length).toBe(3);
  });

  it("keeps the clarification short and conversational in Arabic", async () => {
    const intent = detectAppointmentIntent("احجز لي أقرب موعد الأسبوع القادم", NOW)!;
    const report = await buildAppointmentReport(fakeDb({ slots: mixed }), "u", "ar", intent);
    expect(report.answer).toContain("أي خدمة");
    expect(report.state.awaitingService).toBe(true);
  });

  it("does not clarify when the service is already clear", async () => {
    const intent = detectAppointmentIntent("Book me the earliest academic advising appointment next week", NOW)!;
    expect(intent.unitCode).toBe("ADV");
    const report = await buildAppointmentReport(fakeDb({ slots: mixed }), "u", "en", intent);
    expect(report.state.awaitingService).toBeUndefined();
    expect(report.offeredSlots.length).toBeGreaterThan(0);
  });

  it("allows a cross-unit search only when the student asks for any service", async () => {
    const intent = detectAppointmentIntent(
      "Show me the earliest appointment available from any student service",
      NOW,
    )!;
    expect(intent.anyService).toBe(true);
    const report = await buildAppointmentReport(fakeDb({ slots: mixed }), "u", "en", intent);
    expect(report.state.awaitingService).toBeUndefined();
    expect(report.offeredSlots.length).toBeGreaterThan(0);
  });

  it("matches the student's service reply to exactly one unit", () => {
    const options = [
      { unitCode: "CAREER", label: "Career Counselling" },
      { unitCode: "ADV", label: "Academic Advising" },
      { unitCode: "ACCESS", label: "Accessibility Support" },
    ];
    expect(matchAppointmentService("Career Counselling", options)).toEqual([
      { unitCode: "CAREER", label: "Career Counselling" },
    ]);
    expect(matchAppointmentService("Accessibility Support", options)[0]?.unitCode).toBe("ACCESS");
    expect(matchAppointmentService("something else entirely", options)).toHaveLength(0);
  });

  it("lists only services that really have open slots", async () => {
    const services = await listAppointmentServices(fakeDb({ slots: mixed }), "en");
    expect(services.map((s) => s.unitCode).sort()).toEqual(["ACCESS", "ADV", "CAREER"]);
  });
});
