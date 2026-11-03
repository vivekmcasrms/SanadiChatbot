/**
 * Appointment Agent. Server only.
 *
 * Responsibility: take a student from "I want to meet a career counsellor
 * tomorrow afternoon" to a confirmed, authorised university appointment,
 * entirely inside the Assistant.
 *
 * Identify the service/unit -> read REAL open slots (staff, working hours,
 * duration, remaining seats, location or online link) -> match the student's
 * stated day/time preference -> propose only slots that exist -> the student
 * selects -> the slot is re-validated and booked inside a locked database
 * transaction -> confirm with staff name, unit, date, time, place and code.
 *
 * Every time shown here comes from `list_appointment_availability`; the model
 * never invents a slot, a staff member or a time. Booking, cancelling and
 * rescheduling all go through transactional RPCs that hold row locks, so a
 * duplicate or over-capacity booking is impossible.
 */
import type { Citation, Lang } from "../agent-types";
import { classifyBookSense } from "./book-intent.server";
import type { Db } from "./tools.server";

export const APPOINTMENT_TIMEZONE = "Asia/Dubai";
/** Dubai has no DST, so the offset is a constant. */
const TZ_OFFSET_MS = 4 * 3600_000;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type AvailableSlot = {
  slotId: string;
  start: string;
  end: string;
  seatsLeft: number;
  typeId: string | null;
  typeNameEn: string | null;
  typeNameAr: string | null;
  durationMinutes: number | null;
  locationType: string | null;
  location: string | null;
  meetingLink: string | null;
  requiresApproval: boolean;
  unitId: string | null;
  unitCode: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  unitEmail: string | null;
  staffId: string | null;
  staffName: string | null;
  staffEmail: string | null;
};

export type MyAppointment = {
  appointmentId: string;
  slotId: string;
  status: string;
  confirmationCode: string | null;
  purpose: string | null;
  start: string;
  end: string;
  typeNameEn: string | null;
  typeNameAr: string | null;
  locationType: string | null;
  location: string | null;
  meetingLink: string | null;
  unitCode: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  unitEmail: string | null;
  staffName: string | null;
  staffEmail: string | null;
};

export type AppointmentAction = "book" | "list" | "cancel" | "reschedule";
export type PartOfDay = "morning" | "afternoon" | "evening";

export type AppointmentIntent = {
  action: AppointmentAction;
  unitCode: string | null;
  /** True only when the student explicitly asked to compare across all services. */
  anyService: boolean;
  typeQuery: string | null;
  /** Preferred window, UTC ISO. */
  from: string;
  to: string;
  /** True when the student named a day ("tomorrow", "next week", "Sunday"). */
  explicitDay: boolean;
  dayLabelEn: string | null;
  dayLabelAr: string | null;
  partOfDay: PartOfDay | null;
  /** Preferred start hour in Dubai time, when stated ("at 3 pm"). */
  hour: number | null;
  minute: number | null;
};

export type AppointmentReport = {
  action: AppointmentAction;
  answer: string;
  verified: boolean;
  citations: Citation[];
  offeredSlots: AvailableSlot[];
  upcoming: MyAppointment[];
  proposals: { toolName: string; args: Record<string, unknown> }[];
  /** Persisted so a reopened chat still shows the appointment and the offer. */
  state: {
    action: AppointmentAction;
    unitCode: string | null;
    offeredSlots: {
      slotId: string;
      start: string;
      staffName: string | null;
      unit: string | null;
      typeName: string | null;
    }[];
    upcoming: {
      appointmentId: string;
      start: string;
      confirmationCode: string | null;
      unit: string | null;
      staffName: string | null;
    }[];
    checkedAt: string;
    /** The turn asked "which service?" — the next reply names the unit. */
    awaitingService?: boolean;
    awaitingSince?: string | null;
    serviceOptions?: { unitCode: string | null; label: string }[];
    pendingIntent?: AppointmentIntent | null;
    /**
     * Mode B: the unit publishes no calendar, so these are PREFERRED times the
     * student may request — never availability. Kept separate from
     * `offeredSlots` so the two appointment modes can never be mixed.
     */
    preferredTimes?: { start: string }[];
    requestUnitCode?: string | null;
    requestUnitLabel?: string | null;
  };
};

/* ------------------------------------------------------------------ */
/* Dubai-time helpers                                                  */
/* ------------------------------------------------------------------ */

/** Dubai wall-clock parts of an instant. */
export function dubaiParts(iso: string | Date) {
  const t = (typeof iso === "string" ? new Date(iso) : iso).getTime() + TZ_OFFSET_MS;
  const d = new Date(t);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** UTC instant for a Dubai wall-clock day boundary. */
function dubaiDayStart(base: Date, addDays = 0): Date {
  const p = dubaiParts(base);
  return new Date(Date.UTC(p.year, p.month, p.day + addDays, 0, 0, 0) - TZ_OFFSET_MS);
}

export function formatSlotDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: APPOINTMENT_TIMEZONE,
  }).format(new Date(iso));
}

export function formatSlotTime(iso: string, lang: Lang): string {
  const text = new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: APPOINTMENT_TIMEZONE,
  }).format(new Date(iso));
  // en-GB renders "9:00 am" — keep AM/PM capitalised consistently.
  return lang === "ar" ? text : text.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Intent detection                                                    */
/* ------------------------------------------------------------------ */

const APPOINTMENT_RE =
  /(appointment|book(ing)?|reserve|slot|meet(ing)?|see (someone|a |an )|sit down with|consultation|موعد|مواعيد|حجز|احجز|أحجز|مقابلة|أقابل|لقاء|استشارة)/i;
const CANCEL_RE = /(cancel|call off|drop (my|the) appointment|إلغاء|ألغ|الغاء|إلغ)/i;
const RESCHEDULE_RE =
  /(reschedul|re-schedul|change (my|the) (appointment|time|slot)|move (my|the) appointment|postpone|another (time|slot|day)|different (time|slot|day)|تأجيل|أجل|تغيير الموعد|غير موعدي|موعد آخر|وقت آخر)/i;
const LIST_RE =
  /(my appointments?|upcoming appointment|do i have (an? )?appointment|when is my appointment|show (me )?my appointment|مواعيدي|موعدي|هل لدي موعد|متى موعدي)/i;

/**
 * The only wording that authorises a cross-unit search. Without it, an
 * unspecified request is clarified rather than answered with a mixed list of
 * unrelated services.
 */
const ANY_SERVICE_RE =
  /(any (student )?service|any (unit|department|office)|from any|across (all )?(services|units)|whichever service|all services|أي خدمة|أي وحدة|أي قسم|جميع الخدمات|كل الخدمات)/i;

const UNIT_HINTS: { re: RegExp; unitCode: string; typeQuery: string | null }[] = [
  {
    re: /(career|job|cv|resume|employ|internship|مهني|مهنية|وظيف|سيرة ذاتية|تدريب)/i,
    unitCode: "CAREER",
    typeQuery: null,
  },
  {
    re: /(accessib|disabilit|special needs|إعاقة|احتياجات خاصة|الوصول)/i,
    unitCode: "ACCESS",
    typeQuery: null,
  },
  {
    re: /(academic advis|advisor|adviser|advising|registration advice|study plan|أكاديمي|مرشد|إرشاد|خطة دراسية)/i,
    unitCode: "ADV",
    typeQuery: null,
  },
  {
    re: /(counsell?or|counsel|guidance|مرشد نفسي|استشارة)/i,
    unitCode: "CAREER",
    typeQuery: null,
  },
];

const WEEKDAYS: { re: RegExp; day: number }[] = [
  { re: /(sunday|الأحد|الاحد)/i, day: 0 },
  { re: /(monday|الاثنين|الإثنين)/i, day: 1 },
  { re: /(tuesday|الثلاثاء)/i, day: 2 },
  { re: /(wednesday|الأربعاء|الاربعاء)/i, day: 3 },
  { re: /(thursday|الخميس)/i, day: 4 },
  { re: /(friday|الجمعة)/i, day: 5 },
  { re: /(saturday|السبت)/i, day: 6 },
];

/** Parses "3 pm", "15:00", "الساعة ٣", "at 2:30". */
function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  const ampm = /(\b|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|صباحا|صباحاً|مساء|مساءً)/i.exec(text);
  if (ampm) {
    let h = Number(ampm[2]);
    const m = Number(ampm[3] ?? 0);
    const suffix = (ampm[4] ?? "").toLowerCase();
    const isPm = /p/.test(suffix) || /مساء/.test(suffix);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    if (h >= 0 && h <= 23) return { hour: h, minute: m };
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (h24) return { hour: Number(h24[1]), minute: Number(h24[2]) };
  return null;
}

/**
 * Turns natural language into a bounded search window and a preference filter.
 * Nothing here decides availability — it only narrows what is asked of the
 * database.
 */
export function detectAppointmentIntent(text: string, now = new Date()): AppointmentIntent | null {
  const t = text.trim();
  if (!t) return null;
  // "Find me a good book on deep learning" is a library request, not a
  // booking. The sense of "book" decides, never the isolated word.
  const sense = classifyBookSense(t);
  if (sense === "library" || sense === "ambiguous") return null;
  const mentionsAppointment = APPOINTMENT_RE.test(t);
  const cancel = CANCEL_RE.test(t) && mentionsAppointment;
  const reschedule = RESCHEDULE_RE.test(t) && (mentionsAppointment || /appointment|موعد/i.test(t));
  const list = LIST_RE.test(t);
  if (!mentionsAppointment && !list) return null;

  const action: AppointmentAction = cancel
    ? "cancel"
    : reschedule
      ? "reschedule"
      : list && !/book|reserve|احجز|أحجز|حجز/i.test(t)
        ? "list"
        : "book";

  const hint = UNIT_HINTS.find((h) => h.re.test(t)) ?? null;

  // Day window.
  let from = new Date(now.getTime());
  let to = new Date(now.getTime() + 21 * DAY_MS);
  let explicitDay = false;
  let dayLabelEn: string | null = null;
  let dayLabelAr: string | null = null;

  if (/\b(today)\b|اليوم/i.test(t)) {
    from = new Date(Math.max(now.getTime(), dubaiDayStart(now).getTime()));
    to = dubaiDayStart(now, 1);
    explicitDay = true;
    dayLabelEn = "today";
    dayLabelAr = "اليوم";
  } else if (/\b(tomorrow)\b|غدا|غداً|بكرة|الغد/i.test(t)) {
    from = dubaiDayStart(now, 1);
    to = dubaiDayStart(now, 2);
    explicitDay = true;
    dayLabelEn = "tomorrow";
    dayLabelAr = "غداً";
  } else if (/next week|الأسبوع (القادم|المقبل)|الاسبوع (القادم|المقبل)/i.test(t)) {
    from = dubaiDayStart(now, 7);
    to = dubaiDayStart(now, 14);
    explicitDay = true;
    dayLabelEn = "next week";
    dayLabelAr = "الأسبوع القادم";
  } else if (/this week|هذا الأسبوع|هذا الاسبوع/i.test(t)) {
    from = new Date(now.getTime());
    to = dubaiDayStart(now, 7);
    explicitDay = true;
    dayLabelEn = "this week";
    dayLabelAr = "هذا الأسبوع";
  } else {
    const wd = WEEKDAYS.find((w) => w.re.test(t));
    if (wd) {
      const today = dubaiParts(now).weekday;
      let delta = (wd.day - today + 7) % 7;
      if (delta === 0) delta = 7;
      from = dubaiDayStart(now, delta);
      to = dubaiDayStart(now, delta + 1);
      explicitDay = true;
      dayLabelEn = new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        timeZone: APPOINTMENT_TIMEZONE,
      }).format(from);
      dayLabelAr = new Intl.DateTimeFormat("ar-AE", {
        weekday: "long",
        timeZone: APPOINTMENT_TIMEZONE,
      }).format(from);
    }
  }

  const partOfDay: PartOfDay | null = /afternoon|بعد الظهر|العصر/i.test(t)
    ? "afternoon"
    : /morning|صباح/i.test(t)
      ? "morning"
      : /evening|مساء/i.test(t)
        ? "evening"
        : null;

  const time = parseTimeOfDay(t);

  return {
    action,
    unitCode: hint?.unitCode ?? null,
    anyService: ANY_SERVICE_RE.test(t),
    typeQuery: hint?.typeQuery ?? null,
    from: from.toISOString(),
    to: to.toISOString(),
    explicitDay,
    dayLabelEn,
    dayLabelAr,
    partOfDay,
    hour: time?.hour ?? null,
    minute: time?.minute ?? null,
  };
}

/** Arabic-Indic digits and markdown emphasis must not hide an option number. */
function normalizeSelectionText(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[*_`]/g, " ")
    .trim();
}

/**
 * Resolves a reply to one of the numbered options that were displayed. If
 * Sanadi numbers the choices, the student may answer with the number alone —
 * "1", "Option 2", "Book number 3", or the whole pasted line starting "1.".
 * The number is a pointer to the displayed list, never something to
 * re-interpret, so it wins over any fuzzy time or name matching.
 */
export function parseOptionNumber(text: string, count: number): number | null {
  if (count <= 0) return null;
  const t = normalizeSelectionText(text);
  if (!t) return null;
  const inRange = (raw: string | undefined): number | null => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= count ? n : null;
  };

  // "1", "1.", "1) Monday 21 September · 9:00 AM — Dalal Al Maamari".
  // A bare number must be followed by a list delimiter or nothing at all, so
  // a spoken time ("3 PM") is never read as an option number.
  const leading = /^(\d{1,2})\s*(?:[.)\-:،,]|$)/.exec(t);
  const byLeading = inRange(leading?.[1]);
  if (byLeading) return byLeading;

  // "Option 2", "number 3", "#4", "الخيار 2", "رقم 3"
  const labelled = /(?:option|opt|number|no\.?|#|الخيار|خيار|رقم)\s*#?\s*(\d{1,2})\b/i.exec(t);
  const byLabel = inRange(labelled?.[1]);
  if (byLabel) return byLabel;

  // A short choosing phrase carrying one number and no clock time:
  // "I'll take 1", "book 3 please", "خذ 2".
  const chooses = /\b(take|book|choose|pick|select|go with|want|i'?ll)\b|احجز|اختر|أختار|خذ|أريد/i.test(t);
  const clockish = /\d\s*[:.]\s*\d{2}|\b(am|pm)\b|صباح|مساء|ساعة/i.test(t);
  if (chooses && !clockish && t.length <= 40) {
    const numbers = t.match(/\d{1,2}/g) ?? [];
    if (numbers.length === 1) {
      const only = inRange(numbers[0]);
      if (only) return only;
    }
  }

  return null;
}

/**
 * Matches a short reply ("3 PM", "the second one", "الخيار الأول") against the
 * slots that were actually offered in the previous turn. Returns null when the
 * reply is ambiguous — the agent never guesses which slot to book.
 */
export function parseSlotSelection<
  T extends {
    slotId: string;
    start: string;
    staffName?: string | null;
    unit?: string | null;
    typeName?: string | null;
  },
>(
  text: string,
  offered: T[],
): T | null {

  if (!offered.length) return null;
  const t = text.trim();

  // An exact option number resolves directly to that stored slot, whatever
  // else the message repeats back (pasted date, advisor, session type).
  const option = parseOptionNumber(t, offered.length);
  if (option) return offered[option - 1] ?? null;

  if (t.length > 60) return null;

  // Only a full id counts; short labels must not accidentally match a word.
  const byId = offered.find((s) => s.slotId.length >= 8 && t.includes(s.slotId));
  if (byId) return byId;

  const time = parseTimeOfDay(t);
  if (time) {
    const matches = offered.filter((s) => {
      const p = dubaiParts(s.start);
      return p.hour === time.hour && (time.minute === 0 || p.minute === time.minute);
    });
    if (matches.length === 1) return matches[0] ?? null;
    return null;
  }

  const ordinals: { re: RegExp; index: number }[] = [
    { re: /\b(first|1st)\b|الأول|الاول/i, index: 0 },
    { re: /\b(second|2nd)\b|الثاني/i, index: 1 },
    { re: /\b(third|3rd)\b|الثالث/i, index: 2 },
    { re: /\b(fourth|4th)\b|الرابع/i, index: 3 },
    { re: /\b(fifth|5th)\b|الخامس/i, index: 4 },
  ];
  const ord = ordinals.find((o) => o.re.test(t));
  if (ord) return offered[ord.index] ?? null;


  // Reply by advisor or service wording instead of a number: "مع Amna",
  // "جلسة إرشاد مهني", "the career one with Hamad". Only a single unambiguous
  // match is accepted; shared words across several offers keep it a null.
  const named = matchOfferedSlots(t, offered);
  if (named.length === 1) return named[0] ?? null;
  return null;
}

/** Arabic definite article and letter case must not defeat a name match. */
function slotWord(w: string): string {
  return w.toLowerCase().replace(/^ال/, "");
}

/**
 * Matches a short reply against the advisor, unit and session-type wording of
 * the offered slots. Returns the top-scoring tier: exactly one entry means a
 * confident pick, several mean a genuine ambiguity the caller must clarify
 * (two counsellors offering the same session type), none mean no match.
 */
export function matchOfferedSlots<
  T extends {
    slotId: string;
    start: string;
    staffName?: string | null;
    unit?: string | null;
    typeName?: string | null;
  },
>(text: string, offered: T[]): T[] {
  const t = text.trim();
  if (!offered.length || t.length > 80) return [];
  const words = new Set(
    t
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
      .map(slotWord),
  );
  if (!words.size) return [];
  const scored = offered
    .map((s) => {
      const hay = new Set(
        [s.staffName, s.unit, s.typeName]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(" ")
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 3)
          .map(slotWord),
      );
      let score = 0;
      for (const w of words) if (hay.has(w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.s);
}

/**
 * Slot selection only applies while the conversation is actually in the
 * appointment flow. A stale offer must not capture an ordinal follow-up in
 * another domain — "Is the first one available online?" after a library
 * search is about the first BOOK, not the first offered slot.
 */
export function pickOfferedSlot<
  T extends {
    slotId: string;
    start: string;
    staffName?: string | null;
    unit?: string | null;
    typeName?: string | null;
  },
>(
  text: string,
  offered: T[],
  anchoredDomain: string | null,
): T | null {
  if (anchoredDomain !== null && anchoredDomain !== "appointments") return null;
  return offered.length ? parseSlotSelection(text, offered) : null;
}

/* ------------------------------------------------------------------ */
/* Verified reads                                                      */
/* ------------------------------------------------------------------ */

type AvailabilityRow = {
  slot_id: string;
  start_time: string;
  end_time: string;
  seats_left: number;
  type_id: string | null;
  type_name_en: string | null;
  type_name_ar: string | null;
  duration_minutes: number | null;
  location_type: string | null;
  location: string | null;
  meeting_link: string | null;
  requires_approval: boolean | null;
  unit_id: string | null;
  unit_code: string | null;
  unit_name_en: string | null;
  unit_name_ar: string | null;
  unit_email: string | null;
  staff_id: string | null;
  staff_name: string | null;
  staff_email: string | null;
};

function toSlot(r: AvailabilityRow): AvailableSlot {
  return {
    slotId: r.slot_id,
    start: r.start_time,
    end: r.end_time,
    seatsLeft: r.seats_left,
    typeId: r.type_id,
    typeNameEn: r.type_name_en,
    typeNameAr: r.type_name_ar,
    durationMinutes: r.duration_minutes,
    locationType: r.location_type,
    location: r.location,
    meetingLink: r.meeting_link,
    requiresApproval: r.requires_approval === true,
    unitId: r.unit_id,
    unitCode: r.unit_code,
    unitNameEn: r.unit_name_en,
    unitNameAr: r.unit_name_ar,
    unitEmail: r.unit_email,
    staffId: r.staff_id,
    staffName: r.staff_name,
    staffEmail: r.staff_email,
  };
}

/** Real open slots from the database — staff, seats and working hours included. */
export async function loadAvailability(
  db: Db,
  opts: { unitCode?: string | null; typeQuery?: string | null; from?: string | null; to?: string | null; limit?: number },
): Promise<AvailableSlot[]> {
  const params: Record<string, unknown> = { _limit: opts.limit ?? 40 };
  if (opts.unitCode) params["_unit_code"] = opts.unitCode;
  if (opts.typeQuery) params["_type_query"] = opts.typeQuery;
  if (opts.from) params["_from"] = opts.from;
  if (opts.to) params["_to"] = opts.to;
  const { data, error } = await db.rpc(
    "list_appointment_availability",
    params as never,
  );
  if (error || !data) return [];
  return (data as unknown as AvailabilityRow[]).map(toSlot);
}

/** The signed-in student's own appointments, enriched with staff and place. */
export async function loadMyAppointments(db: Db, includePast = false): Promise<MyAppointment[]> {
  const { data, error } = await db.rpc("my_appointments", { _include_past: includePast });
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map((r) => ({
    appointmentId: String(r["appointment_id"]),
    slotId: String(r["slot_id"]),
    status: String(r["status"] ?? ""),
    confirmationCode: (r["confirmation_code"] as string | null) ?? null,
    purpose: (r["purpose"] as string | null) ?? null,
    start: String(r["start_time"]),
    end: String(r["end_time"]),
    typeNameEn: (r["type_name_en"] as string | null) ?? null,
    typeNameAr: (r["type_name_ar"] as string | null) ?? null,
    locationType: (r["location_type"] as string | null) ?? null,
    location: (r["location"] as string | null) ?? null,
    meetingLink: (r["meeting_link"] as string | null) ?? null,
    unitCode: (r["unit_code"] as string | null) ?? null,
    unitNameEn: (r["unit_name_en"] as string | null) ?? null,
    unitNameAr: (r["unit_name_ar"] as string | null) ?? null,
    unitEmail: (r["unit_email"] as string | null) ?? null,
    staffName: (r["staff_name"] as string | null) ?? null,
    staffEmail: (r["staff_email"] as string | null) ?? null,
  }));
}

/** Applies the student's stated time preference to real slots. */
export function filterByPreference(slots: AvailableSlot[], intent: AppointmentIntent): AvailableSlot[] {
  return slots.filter((s) => {
    const p = dubaiParts(s.start);
    if (intent.hour !== null && p.hour !== intent.hour) return false;
    if (intent.partOfDay === "morning" && p.hour >= 12) return false;
    if (intent.partOfDay === "afternoon" && (p.hour < 12 || p.hour >= 17)) return false;
    if (intent.partOfDay === "evening" && p.hour < 17) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

function unitName(s: { unitNameEn: string | null; unitNameAr: string | null }, lang: Lang) {
  const raw = (lang === "ar" ? s.unitNameAr : s.unitNameEn) ?? null;
  // Legacy demo label: internship services were folded into career services.
  if (raw === "Career and Internship Services") {
    return lang === "ar" ? "مركز التوظيف وشؤون الخريجين" : "Center for Career Placement & Alumni";
  }
  return raw;
}
function typeName(s: { typeNameEn: string | null; typeNameAr: string | null }, lang: Lang) {
  return (lang === "ar" ? s.typeNameAr : s.typeNameEn) ?? null;
}

/* ------------------------------------------------------------------ */
/* Service clarification                                               */
/* ------------------------------------------------------------------ */

export type AppointmentService = {
  unitCode: string | null;
  label: string;
  /** Session types actually published by that unit, used only for matching. */
  typeNames: string[];
  /** True when the unit has real open slots in the window. */
  hasAvailability: boolean;
};

/**
 * The real appointment services a student can ask for: every unit that the
 * institution has marked appointment-enabled, plus every unit with genuinely
 * open slots. Units without a published schedule are still offered — the
 * student is told honestly that times are not configured yet and a real
 * meeting request is routed instead. Nothing is invented.
 */
export async function listAppointmentServices(
  db: Db,
  lang: Lang,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<AppointmentService[]> {
  const enabledUnits = async () => {
    if (typeof (db as { from?: unknown }).from !== "function") return { data: [] };
    return db
      .from("service_units")
      .select("code, name_en, name_ar")
      .eq("appointment_enabled", true)
      .eq("is_active", true);
  };
  const [slots, unitsRes] = await Promise.all([
    loadAvailability(db, { from: opts.from ?? null, to: opts.to ?? null, limit: 200 }),
    enabledUnits().catch(() => ({ data: [] })),
  ]);
  const byUnit = new Map<string, AppointmentService>();
  for (const s of slots) {
    const key = s.unitCode ?? s.unitNameEn ?? "unknown";
    const label = unitName(s, lang) ?? s.unitNameEn ?? s.unitCode ?? "";
    if (!label) continue;
    const entry =
      byUnit.get(key) ?? { unitCode: s.unitCode, label, typeNames: [], hasAvailability: true };
    entry.hasAvailability = true;
    const tn = typeName(s, lang) ?? s.typeNameEn;
    if (tn && !entry.typeNames.includes(tn)) entry.typeNames.push(tn);
    byUnit.set(key, entry);
  }
  for (const u of (unitsRes.data ?? []) as { code: string; name_en: string; name_ar: string }[]) {
    if (byUnit.has(u.code)) continue;
    const label = unitName({ unitNameEn: u.name_en, unitNameAr: u.name_ar }, lang) ?? u.name_en;
    if (!label) continue;
    byUnit.set(u.code, { unitCode: u.code, label, typeNames: [], hasAvailability: false });
  }
  return [...byUnit.values()];
}

/** Display label for a unit code, from the real institutional record. */
export async function appointmentUnitLabel(db: Db, code: string | null, lang: Lang) {
  if (!code) return null;
  if (typeof (db as { from?: unknown }).from !== "function") return null;
  let data: { name_en: string; name_ar: string } | null = null;
  try {
    const res = await db.from("service_units").select("name_en, name_ar").eq("code", code).maybeSingle();
    data = res.data;
  } catch {
    return null;
  }
  if (!data) return null;
  return unitName({ unitNameEn: data.name_en, unitNameAr: data.name_ar }, lang);
}


/**
 * Resolves a short reply ("Career Counselling", "الإرشاد المهني") against the
 * services that were offered. Several matches or none means the caller must
 * keep asking rather than guess a unit.
 */
export function matchAppointmentService(
  text: string,
  services: { unitCode: string | null; label: string; typeNames?: string[] }[],
): { unitCode: string | null; label: string }[] {
  const t = text.trim();
  if (!t || t.length > 80 || !services.length) return [];
  const hint = UNIT_HINTS.find((h) => h.re.test(t)) ?? null;
  if (hint) {
    const byCode = services.filter((s) => s.unitCode === hint.unitCode);
    if (byCode.length === 1) return byCode.map((s) => ({ unitCode: s.unitCode, label: s.label }));
  }
  const words = new Set(
    t
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
      .map(slotWord),
  );
  if (!words.size) return [];
  const scored = services
    .map((s) => {
      const hay = new Set(
        [s.label, ...(s.typeNames ?? [])]
          .join(" ")
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 3)
          .map(slotWord),
      );
      let score = 0;
      for (const w of words) if (hay.has(w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score === best)
    .map((x) => ({ unitCode: x.s.unitCode, label: x.s.label }));
}

/** One short, conversational question plus the real services as compact options. */
export function buildServiceClarification(services: AppointmentService[], lang: Lang): string {
  const ar = lang === "ar";
  return [
    ar
      ? "بالطبع. مع أي خدمة أو وحدة تود الاجتماع؟"
      : "Of course. Which service or unit would you like to meet with?",
    services.map((s) => `- ${s.label}`).join("\n"),
  ].join("\n\n");
}

function placeLine(
  s: { locationType: string | null; location: string | null; meetingLink: string | null },
  lang: Lang,
): string | null {
  const ar = lang === "ar";
  if (s.meetingLink) return `${ar ? "رابط اللقاء" : "Online link"}: ${s.meetingLink}`;
  if (s.location) return s.location;
  if (s.locationType === "online") return ar ? "عن بُعد — سيُرسل الرابط بعد التأكيد." : "Online — the link is sent after confirmation.";
  return null;
}

/**
 * One offered slot, rendered as a compact multi-line block:
 *
 *   1. Friday 18 September · 9:00 AM
 *      Hamad Advisor
 *      Academic Advising · 30 min
 *      Academic Advising Centre, Building F1, Office 204
 *
 * The number is bold ("**1.**"), not a markdown ordered-list marker, so the
 * renderer can never restart the list and repeat "1." for every slot.
 */
export function formatSlotLine(s: AvailableSlot, lang: Lang, index: number): string {
  const ar = lang === "ar";
  const details = [
    [typeName(s, lang), s.durationMinutes ? `${s.durationMinutes} ${ar ? "دقيقة" : "min"}` : null].filter(Boolean).join(" · ") || null,
    placeLine(s, lang),
  ].filter(Boolean);
  const lines = [
    `**${index}.** ${formatSlotDate(s.start, lang)} · ${formatSlotTime(s.start, lang)}`,
    s.staffName ? `   ${s.staffName}` : null,
    ...details.map((d) => `   ${d}`),
  ].filter(Boolean);
  return lines.join("\n");
}

export function formatAppointmentBlock(a: MyAppointment, lang: Lang): string {
  const ar = lang === "ar";
  const lines = [
    `${typeName(a, lang) ?? (ar ? "موعد" : "Appointment")} — ${formatSlotDate(a.start, lang)} · ${formatSlotTime(a.start, lang)}`,
    a.staffName ? `${ar ? "الموظف" : "Staff"}: ${a.staffName}${a.staffEmail ? ` (${a.staffEmail})` : ""}` : null,
    unitName(a, lang) ? `${ar ? "الوحدة" : "Unit"}: ${unitName(a, lang)}${a.unitEmail ? ` (${a.unitEmail})` : ""}` : null,
    placeLine(a, lang),
    a.confirmationCode ? `${ar ? "رمز التأكيد" : "Confirmation code"}: ${a.confirmationCode}` : null,
    `${ar ? "الحالة" : "Status"}: ${a.status}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function citation(lang: Lang): Citation {
  return {
    documentId: null,
    sourceTitle: lang === "ar" ? "نظام مواعيد الجامعة" : "University appointment system",
    owningUnit: null,
    documentVersion: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    citationUrl: null,
    confidence: "high",
  };
}

function stateOf(
  action: AppointmentAction,
  unitCode: string | null,
  offered: AvailableSlot[],
  upcoming: MyAppointment[],
  lang: Lang,
): AppointmentReport["state"] {
  return {
    action,
    unitCode,
    offeredSlots: offered.map((s) => ({
      slotId: s.slotId,
      start: s.start,
      staffName: s.staffName,
      unit: unitName(s, lang),
      typeName: (lang === "ar" ? s.typeNameAr : s.typeNameEn) ?? s.typeNameEn ?? s.typeNameAr,
    })),
    upcoming: upcoming.map((a) => ({
      appointmentId: a.appointmentId,
      start: a.start,
      confirmationCode: a.confirmationCode,
      unit: unitName(a, lang),
      staffName: a.staffName,
    })),
    checkedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* The agent                                                           */
/* ------------------------------------------------------------------ */

/**
 * Runs one appointment turn end to end over verified data. Returns null only
 * when the request is not an appointment request at all.
 */
export async function buildAppointmentReport(
  db: Db,
  _userId: string,
  lang: Lang,
  intent: AppointmentIntent,
): Promise<AppointmentReport> {
  const ar = lang === "ar";
  const upcoming = (await loadMyAppointments(db, false)).filter((a) => a.status !== "cancelled");
  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];
  const citations = [citation(lang)];

  /* ---------------- list ---------------- */
  if (intent.action === "list") {
    const answer = upcoming.length
      ? [
          ar
            ? upcoming.length === 1
              ? "لديك موعد واحد قادم:"
              : `لديك ${upcoming.length} مواعيد قادمة:`
            : upcoming.length === 1
              ? "You have 1 upcoming appointment:"
              : `You have ${upcoming.length} upcoming appointments:`,
          upcoming.map((a) => formatAppointmentBlock(a, lang)).join("\n\n"),
          ar
            ? "يمكنني تغيير الموعد أو إلغاؤه من هنا مباشرة."
            : "I can reschedule or cancel it for you right here.",
        ].join("\n\n")
      : ar
        ? "لا توجد مواعيد قادمة على سجلك. أخبرني بالجهة التي تريد مقابلتها والوقت المناسب لك وسأعرض عليك الأوقات المتاحة فعلياً."
        : "You have no upcoming appointments. Tell me who you would like to meet and when, and I will show you the times that are actually open.";
    if (upcoming[0]) {
      proposals.push({ toolName: "cancel_appointment", args: { appointmentId: upcoming[0].appointmentId } });
    }
    return {
      action: "list",
      answer,
      verified: true,
      citations,
      offeredSlots: [],
      upcoming,
      proposals,
      state: stateOf("list", intent.unitCode, [], upcoming, lang),
    };
  }

  /* ---------------- cancel ---------------- */
  if (intent.action === "cancel") {
    if (!upcoming.length) {
      return {
        action: "cancel",
        answer: ar
          ? "لا يوجد موعد قادم يمكن إلغاؤه على سجلك."
          : "There is no upcoming appointment on your record to cancel.",
        verified: true,
        citations,
        offeredSlots: [],
        upcoming,
        proposals,
        state: stateOf("cancel", intent.unitCode, [], upcoming, lang),
      };
    }
    const target = upcoming[0]!;
    proposals.push({ toolName: "cancel_appointment", args: { appointmentId: target.appointmentId } });
    return {
      action: "cancel",
      answer: [
        ar ? "هذا هو الموعد الذي سيتم إلغاؤه:" : "This is the appointment that would be cancelled:",
        formatAppointmentBlock(target, lang),
        ar
          ? "أكّد الإلغاء وسأحرّر المقعد فوراً وأبلغ الوحدة."
          : "Confirm and I will release the slot immediately and inform the unit.",
      ].join("\n\n"),
      verified: true,
      citations,
      offeredSlots: [],
      upcoming,
      proposals,
      state: stateOf("cancel", intent.unitCode, [], upcoming, lang),
    };
  }

  /* ---------------- reschedule ---------------- */
  if (intent.action === "reschedule") {
    if (!upcoming.length) {
      return {
        action: "reschedule",
        answer: ar
          ? "لا يوجد موعد قادم يمكن تغييره. يمكنني حجز موعد جديد إذا رغبت."
          : "You have no upcoming appointment to move. I can book a new one instead.",
        verified: true,
        citations,
        offeredSlots: [],
        upcoming,
        proposals,
        state: stateOf("reschedule", intent.unitCode, [], upcoming, lang),
      };
    }
    const target = upcoming[0]!;
    const pool = await loadAvailability(db, {
      unitCode: intent.unitCode ?? target.unitCode,
      from: intent.from,
      to: intent.to,
      limit: 40,
    });
    const preferred = filterByPreference(pool, intent);
    const offered = (preferred.length ? preferred : pool).filter((s) => s.slotId !== target.slotId).slice(0, 5);

    if (!offered.length) {
      return {
        action: "reschedule",
        answer: [
          ar ? "موعدك الحالي:" : "Your current appointment:",
          formatAppointmentBlock(target, lang),
          ar
            ? "لا توجد أوقات بديلة مفتوحة في الفترة المطلوبة حالياً. أخبرني بفترة أخرى وسأتحقق من الأوقات المتاحة فعلياً."
            : "There are no alternative open times in that period right now. Give me another period and I will check the real availability again.",
        ].join("\n\n"),
        verified: true,
        citations,
        offeredSlots: [],
        upcoming,
        proposals,
        state: stateOf("reschedule", intent.unitCode, [], upcoming, lang),
      };
    }

    if (offered.length === 1 && (intent.hour !== null || intent.partOfDay) && preferred.length) {
      proposals.push({
        toolName: "reschedule_appointment",
        args: { appointmentId: target.appointmentId, newSlotId: offered[0]!.slotId },
      });
    }
    return {
      action: "reschedule",
      answer: [
        ar ? "موعدك الحالي:" : "Your current appointment:",
        formatAppointmentBlock(target, lang),
        ar ? "هذه الأوقات البديلة المتاحة فعلياً:" : "These alternative times are actually open:",
        offered.map((s, i) => formatSlotLine(s, lang, i + 1)).join("\n"),
        ar
          ? "أخبرني برقم الخيار أو الوقت الذي تفضله، وسأتحقق من التوفر مرة أخرى قبل تعديل الموعد."
          : "Reply with the option number or preferred time, and I'll re-check availability before booking.",
      ].join("\n\n"),
      verified: true,
      citations,
      offeredSlots: offered,
      upcoming,
      proposals,
      state: stateOf("reschedule", intent.unitCode, offered, upcoming, lang),
    };
  }

  /* ---------------- book ---------------- */
  // Clarify the service before searching. A generic "book me the earliest
  // appointment next week" must never return a mixed list of unrelated units.
  if (!intent.unitCode && !intent.anyService) {
    const services = await listAppointmentServices(db, lang, { from: intent.from, to: intent.to });
    if (services.length >= 1) {
      const state = stateOf("book", null, [], upcoming, lang);
      state.awaitingService = true;
      state.awaitingSince = new Date().toISOString();
      state.serviceOptions = services.map((s) => ({ unitCode: s.unitCode, label: s.label }));
      state.pendingIntent = intent;
      return {
        action: "book",
        answer: buildServiceClarification(services, lang),
        verified: true,
        citations,
        offeredSlots: [],
        upcoming,
        proposals,
        state,
      };
    }
    // No unit has real, verified availability published. Never fall back to
    // seeded or demo schedules.
    return {
      action: "book",
      answer: [
        ar
          ? "لا تتوفر لديّ حالياً مواعيد محجوزة مسبقاً لأي خدمة، ولن أعرض أوقاتاً غير حقيقية."
          : "I don't currently have appointment availability configured for any service, and I will not show times that are not real.",
        ar
          ? "أخبرني بالخدمة التي تحتاجها ويمكنني فتح طلب لدى الوحدة المسؤولة لترتيب لقاء."
          : "Tell me which service you need and I can open a request with the responsible unit to arrange a meeting.",
      ].join(" "),
      verified: true,
      citations,
      offeredSlots: [],
      upcoming,
      proposals,
      state: stateOf("book", null, [], upcoming, lang),
    };
  }


  const pool = await loadAvailability(db, {
    unitCode: intent.unitCode,
    typeQuery: intent.typeQuery,
    from: intent.from,
    to: intent.to,
    limit: 40,
  });
  const preferred = filterByPreference(pool, intent);
  let widened = false;
  let slots = preferred;
  if (!slots.length && pool.length) {
    slots = pool;
    widened = true;
  }
  let broadened = false;
  if (!slots.length) {
    // The requested day/period has nothing open; look further ahead rather
    // than telling the student a time that does not exist.
    const later = await loadAvailability(db, {
      unitCode: intent.unitCode,
      typeQuery: intent.typeQuery,
      from: new Date().toISOString(),
      to: new Date(Date.now() + 28 * DAY_MS).toISOString(),
      limit: 40,
    });
    if (later.length) {
      slots = later;
      broadened = true;
    }
  }

  const offered = slots.slice(0, 5);
  const existing = upcoming.find(
    (a) => !intent.unitCode || a.unitCode === intent.unitCode,
  );

  if (!offered.length) {
    // The service is real, the schedule is not published. Say so plainly and
    // offer the routed meeting request instead of any invented time.
    const label = (await appointmentUnitLabel(db, intent.unitCode ?? null, lang)) ?? null;
    const named = label ?? (ar ? "هذه الخدمة" : "this service");
    proposals.push({
      toolName: "escalate_to_human",
      args: {
        reason:
          lang === "ar"
            ? `طلب موعد مع ${named} — لم تُنشر أوقات متاحة بعد.`
            : `Appointment request with ${named} — no published availability yet.`,
        ...(intent.unitCode ? { unitCode: intent.unitCode } : {}),
      },
    });
    return {
      action: "book",
      answer: [
        ar
          ? `وجدت خدمة ${named}، لكن لم يتم إعداد أوقات المواعيد لهذه الوحدة بعد، ولن أعرض عليك أوقاتاً غير حقيقية.`
          : `I found the ${named} service, but appointment availability has not yet been configured for this unit, and I will not show you times that are not real.`,
        ar
          ? `يمكنني إرسال طلب إلى فريق ${named} لترتيب لقاء معك.`
          : `I can send a request to the ${named} team to arrange a meeting.`,
      ].join(" "),
      verified: true,
      citations,
      offeredSlots: [],
      upcoming,
      proposals,
      state: stateOf("book", intent.unitCode, [], upcoming, lang),
    };
  }


  const head: string[] = [];
  if (existing) {
    head.push(
      ar
        ? `لديك بالفعل موعد قادم مع ${unitName(existing, lang) ?? "هذه الوحدة"} يوم ${formatSlotDate(existing.start, lang)} الساعة ${formatSlotTime(existing.start, lang)}. لن أحجز موعداً مكرراً — يمكنني تغييره أو حجز موعد إضافي إذا أكدت ذلك.`
        : `You already have an upcoming appointment with ${unitName(existing, lang) ?? "this unit"} on ${formatSlotDate(existing.start, lang)} at ${formatSlotTime(existing.start, lang)}. I will not create a duplicate booking — I can move that one, or add a second appointment only if you confirm.`,
    );
  }
  if (broadened) {
    head.push(
      ar
        ? `لا توجد أوقات ${intent.dayLabelAr ?? "في الفترة المطلوبة"}. أقرب الأوقات المتاحة فعلياً:`
        : `Nothing is open ${intent.dayLabelEn ?? "in that period"}. The earliest times that are actually available are:`,
    );
  } else if (widened) {
    head.push(
      ar
        ? "لا توجد أوقات مطابقة تماماً لتفضيلك، وهذه أقرب الأوقات المتاحة:"
        : "Nothing matches that exact preference, so here are the closest open times:",
    );
  } else {
    head.push(ar ? "هذه الأوقات المتاحة فعلياً:" : "I found these available times:");
  }

  // A single slot that exactly matches an explicit request is proposed
  // directly; anything less specific is offered as a choice.
  if (offered.length === 1 && !widened && !broadened && (intent.hour !== null || intent.partOfDay)) {
    proposals.push({ toolName: "book_appointment", args: { slotId: offered[0]!.slotId } });
  }

  return {
    action: "book",
    answer: [
      head.join("\n\n"),
      offered.map((s, i) => formatSlotLine(s, lang, i + 1)).join("\n"),
      ar
        ? "أخبرني برقم الخيار أو الوقت الذي تفضله، وسأتحقق من التوفر مرة أخرى قبل الحجز."
        : "Reply with the option number or preferred time, and I'll re-check availability before booking.",
    ].join("\n\n"),
    verified: true,
    citations,
    offeredSlots: offered,
    upcoming,
    proposals,
    state: stateOf("book", intent.unitCode, offered, upcoming, lang),
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/**
 * Tells the student and the staff member what happened. Notification failure
 * never breaks a booking, so every call is best-effort.
 */
export async function notifyAppointmentParties(opts: {
  event: "appointment_booked" | "appointment_changed" | "appointment_cancelled";
  appointmentId: string;
  studentId: string;
  staffUserId: string | null;
  unitId: string | null;
  lang: Lang;
  when: string;
  staffName: string | null;
  unitLabel: string | null;
  place: string | null;
}) {
  const { emitNotification } = await import("@/lib/ops/notify.server");
  const vars = {
    when: `${formatSlotDate(opts.when, opts.lang)} ${formatSlotTime(opts.when, opts.lang)}`,
    staff_name: opts.staffName ?? "",
    unit: opts.unitLabel ?? "",
    location: opts.place ?? "",
  };
  await emitNotification({
    eventType: opts.event,
    entityType: "student_appointment",
    entityId: opts.appointmentId,
    recipientId: opts.studentId,
    language: opts.lang,
    vars,
    actionUrl: "/requests",
    serviceUnitId: opts.unitId,
    dedupeKey: `${opts.event}:${opts.appointmentId}:student`,
  });
  if (opts.staffUserId) {
    await emitNotification({
      eventType: opts.event,
      entityType: "student_appointment",
      entityId: opts.appointmentId,
      recipientId: opts.staffUserId,
      language: "en",
      vars,
      actionUrl: "/cases",
      serviceUnitId: opts.unitId,
      dedupeKey: `${opts.event}:${opts.appointmentId}:staff`,
    });
  }
}
