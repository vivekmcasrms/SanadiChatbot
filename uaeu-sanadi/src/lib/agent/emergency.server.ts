/**
 * Deterministic emergency routing. Server only.
 *
 * Emergency numbers, emails and responsible units are ALWAYS read from
 * `public.emergency_contacts`. The model may help phrase the reply, but it
 * never supplies a number: if no active record matches, we say so plainly.
 */
import type { Db } from "./tools.server";
import type { Citation, Lang } from "../agent-types";

export type EmergencyRecord = {
  id: string;
  code: string;
  categoryEn: string | null;
  categoryAr: string | null;
  typeEn: string | null;
  typeAr: string | null;
  unitEn: string | null;
  unitAr: string | null;
  mobile: string | null;
  emergencyNumber: string | null;
  email: string | null;
  notesEn: string | null;
  notesAr: string | null;
  keywords: string[];
  priority: number;
};

type Row = {
  id: string;
  code: string;
  category_en: string | null;
  category_ar: string | null;
  emergency_type_en: string | null;
  emergency_type_ar: string | null;
  responsible_unit_en: string | null;
  responsible_unit_ar: string | null;
  label_en: string | null;
  label_ar: string | null;
  mobile_number: string | null;
  emergency_number: string | null;
  email: string | null;
  notes_en: string | null;
  notes_ar: string | null;
  keywords: string[] | null;
  priority: number | null;
};

const SELECT =
  "id, code, category_en, category_ar, emergency_type_en, emergency_type_ar, responsible_unit_en, responsible_unit_ar, label_en, label_ar, mobile_number, emergency_number, email, notes_en, notes_ar, keywords, priority";

function toRecord(r: Row): EmergencyRecord {
  return {
    id: r.id,
    code: r.code,
    categoryEn: r.category_en,
    categoryAr: r.category_ar,
    typeEn: r.emergency_type_en,
    typeAr: r.emergency_type_ar,
    unitEn: r.responsible_unit_en ?? r.label_en,
    unitAr: r.responsible_unit_ar ?? r.label_ar,
    mobile: r.mobile_number,
    emergencyNumber: r.emergency_number,
    email: r.email,
    notesEn: r.notes_en,
    notesAr: r.notes_ar,
    keywords: (r.keywords ?? []).filter(Boolean),
    priority: r.priority ?? 100,
  };
}

/** Only records that actually carry a contact channel can answer an emergency. */
export async function loadEmergencyRecords(db: Db): Promise<EmergencyRecord[]> {
  const { data } = await db
    .from("emergency_contacts")
    .select(SELECT)
    .eq("is_active", true)
    .order("priority", { ascending: true });
  return ((data ?? []) as unknown as Row[])
    .map(toRecord)
    .filter((r) => r.emergencyNumber || r.mobile || r.email);
}

/** Unmistakable emergency wording — enough on its own to trigger the fast path. */
const STRONG_RE =
  /(emergency|urgent|fire|smoke|burning|explosion|ambulance|bleeding|unconscious|choking|gas leak|طوارئ|طارئ|طارئة|عاجل|حريق|دخان|انفجار|إسعاف|نزيف|إغماء|تسرب غاز)/i;

/** First-person / incident phrasing that turns a topic word into a live problem. */
const INCIDENT_RE =
  /(\bi\b|\bmy\b|\bwe\b|there is|there's|help|broken|not working|doesn'?t work|stopped|leak|leaking|stuck|missing|stolen|lost|who (do i|should i) (call|contact)|number to call|عندي|لدي|عندنا|يوجد|في\s|ساعد|النجدة|لا يعمل|ما يعمل|معطل|عطل|تسرب|مفقود|فقدت|سرق|ضاع|أتصل|اتصل|رقم)/i;

/** Anything asking for policy text rather than help right now. */
const POLICY_RE =
  /(policy|procedure|regulation|guideline|document|report form|سياسة|لائحة|إجراء|نموذج|وثيقة)/i;

/**
 * Follow-up wording that belongs to an ongoing service conversation, never to
 * a live emergency: "what skills am I missing" is not lost property.
 */
const NON_EMERGENCY_RE =
  /(skill|cv|resume|ats|score|career|job|role|course|credit|gpa|grade|graduat|register|semester|internship|letter|certificate|case|complaint|suggestion|request|library|book|appointment|مهار|سيرة ذاتية|مهني|وظيف|درجة|معدل|مقرر|ساعات|تسجيل|شهادة|خطاب|حالتي|طلبي|مكتبة|موعد)/i;

/** A lost/stolen report needs a physical thing that was lost. */
const LOST_RE = /(lost|missing|stolen|misplaced|left behind|فقد|مفقود|ضاع|سرق|نسيت)/i;
const PROPERTY_RE =
  /(wallet|purse|phone|mobile|laptop|bag|backpack|keys?|card|id\b|emirates id|passport|watch|glasses|jacket|book|charger|headphone|earbud|usb|umbrella|ring|necklace|money|property|belonging|item|محفظ|هاتف|جوال|حاسوب|لابتوب|حقيب|مفاتيح|بطاق|هوي|جواز|ساع|نظار|كتاب|شاحن|سماع|مقتنيات|أغراض|غرض)/i;

const AR_RE = /[\u0600-\u06FF]/;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652]/g, "");
}

function scoreRecord(text: string, record: EmergencyRecord): number {
  let score = 0;
  for (const raw of record.keywords) {
    const kw = normalise(raw);
    if (!kw) continue;
    if (AR_RE.test(kw)) {
      if (text.includes(kw)) score += kw.length > 3 ? 2 : 1;
      continue;
    }
    const pattern = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (pattern.test(text)) score += kw.includes(" ") ? 3 : kw.length > 3 ? 2 : 1;
  }
  return score;
}

export type EmergencyMatch = {
  record: EmergencyRecord;
  score: number;
};

/** Deterministic keyword match against the active emergency records. */
export async function matchEmergency(
  db: Db,
  message: string,
  options?: { activeDomain?: string | null },
): Promise<EmergencyMatch | null> {
  const text = normalise(message);
  if (!text || text.length > 400) return null;
  const strong = STRONG_RE.test(message);
  if (!strong && !INCIDENT_RE.test(message)) return null;
  if (!strong && POLICY_RE.test(message)) return null;
  // A first-person report of a lost or stolen physical item is lost property
  // even when it mentions a service word as a location ("near the library").
  const lostProperty = LOST_RE.test(message) && PROPERTY_RE.test(message);
  // Routing priority: an explicit, unmistakable emergency always wins, but a
  // weak signal never overrides ordinary service wording or the topic the
  // student is already discussing.
  if (!strong && !lostProperty && NON_EMERGENCY_RE.test(message)) return null;
  if (!strong && options?.activeDomain) return null;
  // "I am missing X" is only lost property when a physical item is named.
  if (!strong && LOST_RE.test(message) && !PROPERTY_RE.test(message)) return null;

  const records = await loadEmergencyRecords(db);
  let best: EmergencyMatch | null = null;
  for (const record of records) {
    const score = scoreRecord(text, record);
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && record.priority < best.record.priority)) {
      best = { record, score };
    }
  }
  if (!best) return null;
  if (!strong && best.score < 2) return null;
  return best;
}

export function emergencyCitation(record: EmergencyRecord, lang: Lang): Citation {
  return {
    documentId: null,
    sourceTitle:
      lang === "ar" ? "سجل جهات الطوارئ المعتمد في الجامعة" : "Official university emergency contact register",
    owningUnit: (lang === "ar" ? record.unitAr : record.unitEn) ?? null,
    documentVersion: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    citationUrl: null,
    confidence: "high",
  };
}

/** Short, prominent, database-only answer. No explanations, no invented detail. */
export function formatEmergencyAnswer(record: EmergencyRecord, lang: Lang): string {
  const ar = lang === "ar";
  const category = (ar ? record.categoryAr : record.categoryEn) ?? "";
  const type = (ar ? record.typeAr : record.typeEn) ?? "";
  const unit = (ar ? record.unitAr : record.unitEn) ?? "";
  const notes = ar ? record.notesAr : record.notesEn;
  const lines: string[] = [];
  lines.push(ar ? `## ${category || "طوارئ"} — اتصل الآن` : `## ${category || "Emergency"} — call now`);
  if (type) lines.push(ar ? `**نوع الحالة:** ${type}` : `**Situation:** ${type}`);
  if (unit) lines.push(ar ? `**الجهة المسؤولة:** ${unit}` : `**Responsible unit:** ${unit}`);
  if (record.emergencyNumber)
    lines.push(ar ? `**رقم الطوارئ:** ${record.emergencyNumber}` : `**Emergency number:** ${record.emergencyNumber}`);
  if (record.mobile) lines.push(ar ? `**الهاتف المتحرك:** ${record.mobile}` : `**Mobile:** ${record.mobile}`);
  if (record.email) lines.push(ar ? `**البريد الإلكتروني:** ${record.email}` : `**Email:** ${record.email}`);
  if (notes) lines.push(notes);
  lines.push(
    ar
      ? "إذا كانت الحياة في خطر، اتصل بالرقم 999 فورًا."
      : "If life is at risk, call 999 immediately.",
  );
  return lines.join("\n\n");
}
