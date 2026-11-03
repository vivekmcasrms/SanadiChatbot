export const HOSTEL_RULE_VERSION = "hostel-v1";
export function normalizeHomeCity(city: string): string {
  return city.trim().toLowerCase().replace(/[\s‐‑–—-]+/g, "");
}
export function evaluateHostelEligibility(homeCity: string | null, credits: number | null) {
  if (!homeCity?.trim()) return { eligible: false, reason: "missing_city", roomType: null, hostels: [] } as const;
  if (["alain", "العين"].includes(normalizeHomeCity(homeCity)))
    return { eligible: false, reason: "al_ain", roomType: null, hostels: [] } as const;
  if (credits === null || !Number.isInteger(credits) || credits < 0)
    return { eligible: false, reason: "missing_credits", roomType: null, hostels: [] } as const;
  return { eligible: true, reason: null, roomType: credits >= 60 ? "single" : "double", hostels: credits >= 60 ? ["A"] : ["B", "C"] } as const;
}
export function isHostelIntent(text: string): boolean {
  if (/(bus|transport|maintenance|broken|leak|complain|suggest|meeting|اجتماع|حجز قاعة|حافلة|مواصلات|صيانة|شكوى|اقتراح)/i.test(text)) return false;
  // A room request without the word "hostel" ("can I book a room") is still
  // housing: at this university booking a room means a hostel room, and it
  // must never fall through to the meeting/appointment flow.
  if (
    /\b(?:book|reserve|get|need|want|apply for)\b[^.?!]{0,24}\b(?:a |the |my )?room\b/i.test(text) ||
    /\broom\b[^.?!]{0,24}\b(?:book|reserve)\b/i.test(text) ||
    /(?:حجز|أحجز|احجز|أبغي|ابغي|أريد|أبي|ابي)[^\n.؟!]{0,10}غرفة|غرفتي\b/i.test(text) ||
    /(?:حجز|أحجز|احجز|أبغي|ابغي|أبغى|أبي|ابي|ودي|أريد)[^\n.؟!]{0,10}(?:سكن|السكن)(?:\s|$|[.؟!،])/i.test(text)
  )
    return true;
  return /\b(hostel|dorm(?:itory)?|accommodation|university housing|student housing|single room|double room|room booking)\b|السكن الجامعي|حجز السكن|غرفة في السكن|أستحق السكن|طلب السكن|غرفة فردية|غرفة مزدوجة/i.test(text);
}
export function asksForHostelSubmission(text: string): boolean {
  return /\b(book|apply|submit|request|want|need)\b|حجز|أريد|ابغي|أبغي|قدم|طلب/i.test(text) && !/\b(status|which|eligible|can i|confirmed|assigned)\b|حالة|هل|أي|مؤكد|تأكيد/i.test(text);
}