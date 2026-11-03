/**
 * Library opening hours. Server only.
 *
 * Open/closed is always computed from the configured Asia/Dubai clock plus the
 * stored weekly schedule and date exceptions — never guessed by the model.
 */
import type { Db } from "../agent/tools.server";

export type LibraryLocation = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  campusEn: string | null;
  campusAr: string | null;
  buildingEn: string | null;
  buildingAr: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  mapUrl: string | null;
};

export type DayHours = { dayOfWeek: number; closed: boolean; opensAt: string | null; closesAt: string | null };

export type LibraryHoursStatus = {
  location: LibraryLocation;
  timezone: string;
  localDate: string;
  localTime: string;
  dayOfWeek: number;
  isOpenNow: boolean;
  todayOpensAt: string | null;
  todayClosesAt: string | null;
  closesInMinutes: number | null;
  exceptionReasonEn: string | null;
  exceptionReasonAr: string | null;
  nextOpenDay: number | null;
  nextOpenAt: string | null;
  week: DayHours[];
};

const TZ = "Asia/Dubai";

/** Current wall-clock date/time in the library timezone, independent of server locale. */
export function nowInDubai(): { date: string; time: string; minutes: number; dayOfWeek: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour") === "24" ? "0" : get("hour"));
  const minute = Number(get("minute"));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
    dayOfWeek: weekdays[get("weekday")] ?? new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

const toMinutes = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/**
 * Resolves the live open/closed state for one or all branches. Exceptions
 * (holidays, special days) always override the weekly schedule.
 */
export async function getLibraryHours(db: Db, locationCode?: string | null): Promise<LibraryHoursStatus[]> {
  let locationQuery = db
    .from("library_locations")
    .select(
      "id, code, name_en, name_ar, campus_en, campus_ar, building_en, building_ar, contact_email, contact_phone, map_url, timezone, sort_order",
    )
    .eq("is_active", true)
    .order("sort_order");
  if (locationCode) locationQuery = locationQuery.eq("code", locationCode.toUpperCase());

  const { data: locations } = await locationQuery;
  if (!locations?.length) return [];
  const ids = locations.map((l) => l.id);
  const clock = nowInDubai();

  const [{ data: hours }, { data: exceptions }] = await Promise.all([
    db
      .from("library_opening_hours")
      .select("library_location_id, day_of_week, opens_at, closes_at, closed")
      .in("library_location_id", ids),
    db
      .from("library_hours_exceptions")
      .select("library_location_id, exception_date, opens_at, closes_at, closed, reason_en, reason_ar")
      .in("library_location_id", ids)
      .gte("exception_date", clock.date)
      .lte("exception_date", new Date(Date.parse(`${clock.date}T00:00:00Z`) + 8 * 86400000).toISOString().slice(0, 10)),
  ]);

  return locations.map((l) => {
    const week: DayHours[] = Array.from({ length: 7 }, (_, day) => {
      const row = (hours ?? []).find((h) => h.library_location_id === l.id && h.day_of_week === day);
      return {
        dayOfWeek: day,
        closed: row ? row.closed : true,
        opensAt: hhmm(row?.opens_at ?? null),
        closesAt: hhmm(row?.closes_at ?? null),
      };
    });

    const todayException = (exceptions ?? []).find(
      (e) => e.library_location_id === l.id && e.exception_date === clock.date,
    );
    const base = week[clock.dayOfWeek] ?? { closed: true, opensAt: null, closesAt: null };
    const today = todayException
      ? {
          closed: todayException.closed,
          opensAt: hhmm(todayException.opens_at),
          closesAt: hhmm(todayException.closes_at),
        }
      : { closed: base.closed, opensAt: base.opensAt, closesAt: base.closesAt };

    const opensMin = toMinutes(today.opensAt);
    const closesMin = toMinutes(today.closesAt);
    const isOpenNow =
      !today.closed && opensMin !== null && closesMin !== null && clock.minutes >= opensMin && clock.minutes < closesMin;

    let nextOpenDay: number | null = null;
    let nextOpenAt: string | null = null;
    if (!isOpenNow) {
      for (let step = 0; step < 8; step += 1) {
        const day = (clock.dayOfWeek + step) % 7;
        const dayDate = new Date(Date.parse(`${clock.date}T00:00:00Z`) + step * 86400000).toISOString().slice(0, 10);
        const exc = (exceptions ?? []).find((e) => e.library_location_id === l.id && e.exception_date === dayDate);
        const candidate = exc
          ? { closed: exc.closed, opensAt: hhmm(exc.opens_at) }
          : { closed: week[day]?.closed ?? true, opensAt: week[day]?.opensAt ?? null };
        if (candidate.closed || !candidate.opensAt) continue;
        if (step === 0 && toMinutes(candidate.opensAt)! <= clock.minutes) continue;
        nextOpenDay = day;
        nextOpenAt = candidate.opensAt;
        break;
      }
    }

    return {
      location: {
        id: l.id,
        code: l.code,
        nameEn: l.name_en,
        nameAr: l.name_ar,
        campusEn: l.campus_en,
        campusAr: l.campus_ar,
        buildingEn: l.building_en,
        buildingAr: l.building_ar,
        contactEmail: l.contact_email,
        contactPhone: l.contact_phone,
        mapUrl: l.map_url,
      },
      timezone: l.timezone ?? TZ,
      localDate: clock.date,
      localTime: clock.time,
      dayOfWeek: clock.dayOfWeek,
      isOpenNow,
      todayOpensAt: today.closed ? null : today.opensAt,
      todayClosesAt: today.closed ? null : today.closesAt,
      closesInMinutes: isOpenNow && closesMin !== null ? closesMin - clock.minutes : null,
      exceptionReasonEn: todayException?.reason_en ?? null,
      exceptionReasonAr: todayException?.reason_ar ?? null,
      nextOpenDay,
      nextOpenAt,
      week,
    };
  });
}

export type LibraryServiceInfo = {
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  eligibilityEn: string | null;
  eligibilityAr: string | null;
  instructionsEn: string | null;
  instructionsAr: string | null;
  availabilityEn: string | null;
  availabilityAr: string | null;
  category: string;
  url: string | null;
  contact: string | null;
};

/** Approved library service configuration — the only source for service answers. */
export async function getLibraryServices(db: Db, topic?: string | null): Promise<LibraryServiceInfo[]> {
  const { data } = await db
    .from("library_services")
    .select(
      "service_key, name_en, name_ar, description_en, description_ar, eligibility_en, eligibility_ar, instructions_en, instructions_ar, availability_en, availability_ar, category, url, contact, sort_order",
    )
    .eq("is_active", true)
    .order("sort_order");

  const rows = (data ?? []).map((s) => ({
    key: s.service_key,
    nameEn: s.name_en,
    nameAr: s.name_ar,
    descriptionEn: s.description_en,
    descriptionAr: s.description_ar,
    eligibilityEn: s.eligibility_en,
    eligibilityAr: s.eligibility_ar,
    instructionsEn: s.instructions_en,
    instructionsAr: s.instructions_ar,
    availabilityEn: s.availability_en,
    availabilityAr: s.availability_ar,
    category: s.category,
    url: s.url,
    contact: s.contact,
  }));

  const term = (topic ?? "").trim().toLowerCase();
  if (!term) return rows;
  const matched = rows.filter((r) =>
    [r.key, r.nameEn, r.nameAr, r.descriptionEn, r.descriptionAr, r.category]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term)),
  );
  return matched.length ? matched : rows;
}
