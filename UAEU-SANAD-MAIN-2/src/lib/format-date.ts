/**
 * Bilingual, human-friendly date presentation.
 * Institutional precision is preserved: the exact date is always shown,
 * relative wording is only added as context.
 */

export type DateLang = "en" | "ar";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "9 Sep 2026" / "٩ سبتمبر ٢٠٢٦" */
export function formatDate(value: string | Date | null | undefined, lang: DateLang = "en"): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** "9 Sep 2026, 14:30" */
export function formatDateTime(value: string | Date | null | undefined, lang: DateLang = "en"): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "2 days ago" / "in 5 days" / "today" — null when the gap is not interesting. */
export function relativeDate(value: string | Date | null | undefined, lang: DateLang = "en"): string | null {
  const d = toDate(value);
  if (!d) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (Math.abs(days) > 60) return null;
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-AE" : "en", { numeric: "auto" });
  if (Math.abs(days) >= 1) return rtf.format(days, "day");
  const hours = Math.round((d.getTime() - Date.now()) / 3_600_000);
  if (Math.abs(hours) >= 1) return rtf.format(hours, "hour");
  return lang === "ar" ? "الآن" : "just now";
}

/** Exact date plus relative context: "9 Sep 2026 · in 5 days". */
export function formatDateWithContext(
  value: string | Date | null | undefined,
  lang: DateLang = "en",
): string {
  const exact = formatDate(value, lang);
  if (exact === "—") return exact;
  const rel = relativeDate(value, lang);
  return rel ? `${exact} · ${rel}` : exact;
}

/** Due-date wording for requirements and deadlines. */
export function formatDueDate(value: string | Date | null | undefined, lang: DateLang = "en"): string {
  const d = toDate(value);
  if (!d) return lang === "ar" ? "بدون موعد نهائي" : "No due date";
  const rel = relativeDate(value, lang);
  const exact = formatDate(d, lang);
  if (!rel) return exact;
  return lang === "ar" ? `${exact} (${rel})` : `${exact} (${rel})`;
}