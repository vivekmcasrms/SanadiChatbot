/** Client-safe bilingual presentation of service availability (UAE time). */
import type { Lang } from "../agent-types";
import { UNIVERSITY_TIMEZONE, type ServiceAvailability } from "./availability-types";

export function formatUae(value: string | null, lang: Lang, withTime = false): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
    timeZone: UNIVERSITY_TIMEZONE,
  }).format(d);
}

export function availabilityWindowLabel(a: ServiceAvailability, lang: Lang): string | null {
  const from = formatUae(a.isAvailable ? a.opensAt : a.nextOpenAt, lang);
  const to = formatUae(a.isAvailable ? a.closesAt : a.nextCloseAt, lang);
  if (from && to) return `${from} – ${to}`;
  return from ?? to;
}

/** Short chip label: "Open", "Opens 15 January 2027", "Currently closed". */
export function availabilityChip(a: ServiceAvailability, lang: Lang): string {
  const ar = lang === "ar";
  switch (a.status) {
    case "always_available":
      return ar ? "متاحة دائماً" : "Available now";
    case "open":
      return ar ? "مفتوحة" : "Open";
    case "closing_soon": {
      const d = formatUae(a.closesAt, lang);
      return ar ? `تغلق ${d ?? "قريباً"}` : `Closes ${d ?? "soon"}`;
    }
    case "opens_soon": {
      const d = formatUae(a.nextOpenAt, lang);
      return ar ? `تفتح ${d ?? "قريباً"}` : `Opens ${d ?? "soon"}`;
    }
    case "temporarily_suspended":
      return ar ? "موقوفة مؤقتاً" : "Temporarily suspended";
    case "admin_disabled":
      return ar ? "غير مفعّلة" : "Not available";
    default: {
      const d = formatUae(a.nextOpenAt, lang);
      return d ? (ar ? `تفتح ${d}` : `Opens ${d}`) : ar ? "مغلقة حالياً" : "Currently closed";
    }
  }
}

/** Student-friendly explanation used in chat and on service pages. */
export function availabilityMessage(a: ServiceAvailability, lang: Lang): string {
  const ar = lang === "ar";
  const name = (ar ? a.serviceNameAr : a.serviceNameEn) ?? (ar ? "هذه الخدمة" : "This service");
  if (a.isAvailable) {
    const until = formatUae(a.closesAt, lang);
    if (until) return ar ? `${name} مفتوحة حالياً حتى ${until}.` : `${name} is open now until ${until}.`;
    return ar ? `${name} متاحة الآن.` : `${name} is available now.`;
  }
  const custom = ar ? a.studentMessageAr : a.studentMessageEn;
  const reason = ar ? a.reasonAr : a.reasonEn;
  const parts: string[] = [];
  if (a.status === "temporarily_suspended") {
    parts.push(ar ? `${name} موقوفة مؤقتاً.` : `${name} is temporarily suspended.`);
  } else if (a.status === "admin_disabled") {
    parts.push(ar ? `${name} غير مفعّلة حالياً.` : `${name} is not currently enabled.`);
  } else {
    parts.push(ar ? `${name} ليست مفتوحة حالياً.` : `${name} is not currently open.`);
  }
  const from = formatUae(a.nextOpenAt, lang);
  const to = formatUae(a.nextCloseAt, lang);
  if (from) {
    if (to) {
      parts.push(
        ar
          ? `الفترة القادمة من ${from} إلى ${to}.`
          : `The next period is scheduled to open on ${from} and close on ${to}.`,
      );
    } else {
      parts.push(ar ? `الفترة القادمة تبدأ في ${from}.` : `The next period opens on ${from}.`);
    }
  }
  if (custom) parts.push(custom);
  else if (reason) parts.push(reason);
  return parts.join(" ");
}
