/** Working-day / working-hour arithmetic driven by working_calendars + calendar_exceptions. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WorkingCalendar = {
  id: string;
  timezone: string;
  working_days: number[];
  working_start_time: string;
  working_end_time: string;
  exceptions: Map<string, { is_working_day: boolean }>;
};

let cached: { at: number; cal: WorkingCalendar } | null = null;

function toMinutes(time: string) {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function loadCalendar(): Promise<WorkingCalendar> {
  if (cached && Date.now() - cached.at < 60_000) return cached.cal;

  const { data: rows } = await supabaseAdmin
    .from("working_calendars")
    .select("id, timezone, working_days, working_start_time, working_end_time, is_default")
    .order("is_default", { ascending: false })
    .limit(1);

  const row = rows?.[0];
  const id = row?.id ?? null;
  const exceptions = new Map<string, { is_working_day: boolean }>();

  if (id) {
    const { data: exRows } = await supabaseAdmin
      .from("calendar_exceptions")
      .select("exception_date, is_working_day")
      .eq("working_calendar_id", id);
    for (const ex of exRows ?? []) {
      exceptions.set(ex.exception_date, { is_working_day: ex.is_working_day });
    }
  }

  const cal: WorkingCalendar = {
    id: id ?? "default",
    timezone: row?.timezone ?? "Asia/Dubai",
    working_days: Array.isArray(row?.working_days) ? (row.working_days as number[]) : [1, 2, 3, 4, 5],
    working_start_time: row?.working_start_time ?? "08:00",
    working_end_time: row?.working_end_time ?? "17:00",
    exceptions,
  };
  cached = { at: Date.now(), cal };
  return cal;
}

export function isWorkingDay(cal: WorkingCalendar, d: Date) {
  const override = cal.exceptions.get(dateKey(d));
  if (override) return override.is_working_day;
  return cal.working_days.includes(d.getUTCDay());
}

/** Add N working hours to a start instant, respecting working days/hours and holidays. */
export function addWorkingHours(cal: WorkingCalendar, start: Date, hours: number): Date {
  const startMin = toMinutes(cal.working_start_time);
  const endMin = toMinutes(cal.working_end_time);
  const dayCapacity = Math.max(60, endMin - startMin);

  let remaining = Math.round(hours * 60);
  const cursor = new Date(start.getTime());
  let guard = 0;

  while (remaining > 0 && guard < 5000) {
    guard += 1;
    if (!isWorkingDay(cal, cursor)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      continue;
    }
    const currentMin = cursor.getUTCHours() * 60 + cursor.getUTCMinutes();
    if (currentMin < startMin) {
      cursor.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      continue;
    }
    if (currentMin >= endMin) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      continue;
    }
    const available = Math.min(endMin - currentMin, dayCapacity);
    if (remaining <= available) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + remaining);
      remaining = 0;
    } else {
      remaining -= available;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    }
  }
  return cursor;
}

/** Add N working days (holidays and non-working weekdays skipped). */
export function addWorkingDays(cal: WorkingCalendar, start: Date, days: number): Date {
  const cursor = new Date(start.getTime());
  let left = Math.max(0, Math.round(days));
  let guard = 0;
  while (left > 0 && guard < 3650) {
    guard += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cal, cursor)) left -= 1;
  }
  const endMin = toMinutes(cal.working_end_time);
  cursor.setUTCHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  return cursor;
}