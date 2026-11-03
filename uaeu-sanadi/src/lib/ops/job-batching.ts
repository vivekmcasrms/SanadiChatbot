/** Pure helpers for scheduled-job batching and run statistics. */

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type JobStats = {
  processed: number;
  skipped: number;
  errors: number;
  pages: number;
  truncated: boolean;
  details: Record<string, number>;
};

export function makeJobStats(): JobStats {
  return { processed: 0, skipped: 0, errors: 0, pages: 0, truncated: false, details: {} };
}

/** Is an appointment start inside the reminder window [now, now + hours]? */
export function inReminderWindow(startIso: string, now: number, hours: number): boolean {
  const t = new Date(startIso).getTime();
  return Number.isFinite(t) && t >= now && t <= now + hours * 3600_000;
}

/** Days left before an information request is due (null when no due date). */
export function infoRequestAction(
  dueIso: string | null,
  reminderDays: number | null,
  now: number,
): { action: "expire" } | { action: "remind"; daysLeft: number } | { action: "skip" } {
  if (!dueIso) return { action: "skip" };
  const due = new Date(dueIso).getTime();
  if (now > due) return { action: "expire" };
  const daysLeft = Math.ceil((due - now) / 86_400_000);
  if (daysLeft > (reminderDays ?? 3)) return { action: "skip" };
  return { action: "remind", daysLeft };
}
