/**
 * Existing-case context beats generic service routing.
 *
 * When a student names a request ("is my UAEU-2026-01063 meeting confirmed?"),
 * or asks a short follow-up about the request the conversation is already on,
 * the answer is read straight from that case record — never invented, and never
 * turned into a new booking or service-promotion flow.
 */
import type { Lang } from "@/lib/agent-types";

export const CASE_REF_RE = /\b(UAEU-\d{4}-\d{3,8})\b/i;

/** A question about an existing request rather than a new service request. */
const EXISTING_CASE_QUESTION_RE =
  /(meeting|appointment|confirm|time|when|where|location|link|who (is|'s)? ?(handling|responsible|dealing)|status|progress|update|reschedul|assigned)/i;
const EXISTING_CASE_QUESTION_AR_RE =
  /(اللقاء|الاجتماع|الموعد|مؤكد|تأكيد|الوقت|متى|أين|المكان|الرابط|من يتابع|من المسؤول|الحالة|التحديث|إعادة جدولة|مسند)/;

/** A message that opens a brand-new request must not be answered from history. */
const NEW_REQUEST_RE =
  /\b(new (request|complaint|case)|open a|raise a|submit|file a|book (an|a) (new )?appointment)\b|طلب جديد|شكوى جديدة|فتح طلب/i;

export function detectCaseReference(text: string): string | null {
  const m = CASE_REF_RE.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

export function isExistingCaseQuestion(text: string): boolean {
  if (NEW_REQUEST_RE.test(text)) return false;
  return EXISTING_CASE_QUESTION_RE.test(text) || EXISTING_CASE_QUESTION_AR_RE.test(text);
}

export type CaseSnapshot = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  unit: string | null;
  staffName: string | null;
  meeting: { at: string; mode: string | null; location: string | null; note: string | null } | null;
};

type Db = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> };
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
};

type CaseRow = {
  id: string;
  case_number: string;
  title: string | null;
  status: string;
  student_id: string;
  assigned_to: string | null;
  meeting_at: string | null;
  meeting_mode: string | null;
  meeting_location: string | null;
  meeting_note: string | null;
  service_units: { name_en: string | null; name_ar: string | null } | null;
};

/** Loads one of the signed-in student's own cases by reference number. */
export async function loadCaseByReference(
  db: unknown,
  studentId: string,
  reference: string,
  lang: Lang,
): Promise<CaseSnapshot | null> {
  const client = db as Db;
  const { data } = await (
    client.from("cases").select(
      "id, case_number, title, status, student_id, assigned_to, meeting_at, meeting_mode, meeting_location, meeting_note, service_units:service_unit_id (name_en, name_ar)",
    ) as never as {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: CaseRow | null }> };
      };
    }
  )
    .eq("case_number", reference)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data) return null;

  let staffName: string | null = null;
  if (data.assigned_to) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", data.assigned_to)
      .maybeSingle();
    staffName = p?.full_name ?? null;
  }

  return {
    id: data.id,
    reference: data.case_number,
    title: data.title,
    status: data.status,
    unit: (lang === "ar" ? data.service_units?.name_ar : data.service_units?.name_en) ?? null,
    staffName,
    meeting: data.meeting_at
      ? {
          at: data.meeting_at,
          mode: data.meeting_mode,
          location: data.meeting_location,
          note: data.meeting_note,
        }
      : null,
  };
}

const MODE_LABEL: Record<string, { en: string; ar: string }> = {
  in_person: { en: "In person", ar: "حضورياً" },
  online: { en: "Online", ar: "عن بُعد" },
  phone: { en: "Phone", ar: "هاتفياً" },
};

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  submitted: { en: "Submitted", ar: "تم الإرسال" },
  acknowledged: { en: "Acknowledged", ar: "تم الاستلام" },
  assigned: { en: "Assigned", ar: "تم الإسناد" },
  in_review: { en: "Under review", ar: "قيد المراجعة" },
  in_progress: { en: "In progress", ar: "قيد المعالجة" },
  resolved: { en: "Resolved", ar: "تم الحل" },
  closed: { en: "Closed", ar: "مغلق" },
};

function when(at: string, lang: Lang) {
  const d = new Date(at);
  return {
    date: d.toLocaleDateString(lang === "ar" ? "ar-AE" : "en-GB", {
      timeZone: "Asia/Dubai",
      dateStyle: "full",
    }),
    time: d.toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-GB", {
      timeZone: "Asia/Dubai",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

/** Plain bilingual answer built only from what the case actually stores. */
export function formatCaseAnswer(snapshot: CaseSnapshot, lang: Lang, askedAboutMeeting: boolean): string {
  const ar = lang === "ar";
  const status =
    (ar ? STATUS_LABEL[snapshot.status]?.ar : STATUS_LABEL[snapshot.status]?.en) ?? snapshot.status;
  const unit = snapshot.unit ?? (ar ? "الجهة المسؤولة" : "the responsible unit");
  const staff = snapshot.staffName ?? (ar ? "لم يتم تحديد موظف بعد" : "not assigned yet");

  if (askedAboutMeeting && !snapshot.meeting) {
    return ar
      ? `لم يتم تأكيد أي موعد لقاء حتى الآن للطلب ${snapshot.reference}.\n\n- الحالة: ${status}\n- الجهة: ${unit}\n- الموظف المسؤول: ${staff}\n\nسأبلغك فور تحديد الموظف المسؤول لموعد اللقاء.`
      : `No meeting time has been confirmed yet for request ${snapshot.reference}.\n\n- Status: ${status}\n- Unit: ${unit}\n- Responsible staff: ${staff}\n\nYou will be notified as soon as the responsible staff member sets a time.`;
  }

  if (snapshot.meeting) {
    const w = when(snapshot.meeting.at, lang);
    const mode = snapshot.meeting.mode
      ? ar
        ? MODE_LABEL[snapshot.meeting.mode]?.ar
        : MODE_LABEL[snapshot.meeting.mode]?.en
      : null;
    const lines = ar
      ? [
          `نعم، تم تأكيد اللقاء الخاص بالطلب ${snapshot.reference}.`,
          "",
          `- التاريخ: ${w.date}`,
          `- الوقت: ${w.time} (توقيت الإمارات)`,
          ...(mode ? [`- الطريقة: ${mode}`] : []),
          ...(snapshot.meeting.location ? [`- المكان / الرابط: ${snapshot.meeting.location}`] : []),
          `- الموظف المسؤول: ${staff}`,
          `- الجهة: ${unit}`,
          `- الحالة: ${status}`,
          ...(snapshot.meeting.note ? ["", snapshot.meeting.note] : []),
        ]
      : [
          `Yes. Your meeting for request ${snapshot.reference} is confirmed.`,
          "",
          `- Date: ${w.date}`,
          `- Time: ${w.time} (UAE time)`,
          ...(mode ? [`- Mode: ${mode}`] : []),
          ...(snapshot.meeting.location ? [`- Location / link: ${snapshot.meeting.location}`] : []),
          `- Responsible staff: ${staff}`,
          `- Unit: ${unit}`,
          `- Status: ${status}`,
          ...(snapshot.meeting.note ? ["", snapshot.meeting.note] : []),
        ];
    return lines.join("\n");
  }

  return ar
    ? `طلبك ${snapshot.reference}${snapshot.title ? ` (${snapshot.title})` : ""}:\n\n- الحالة: ${status}\n- الجهة: ${unit}\n- الموظف المسؤول: ${staff}\n- اللقاء: لم يتم تأكيد موعد بعد.`
    : `Request ${snapshot.reference}${snapshot.title ? ` (${snapshot.title})` : ""}:\n\n- Status: ${status}\n- Unit: ${unit}\n- Responsible staff: ${staff}\n- Meeting: no time confirmed yet.`;
}

export function askedAboutMeeting(text: string): boolean {
  return /(meeting|appointment|when|what time|where|location|link|reschedul)/i.test(text) ||
    /(اللقاء|الاجتماع|الموعد|متى|الوقت|أين|المكان|الرابط|إعادة جدولة)/.test(text);
}
