/**
 * Mode B — Appointment REQUEST (no published availability).
 *
 * When a real unit exists but has published no appointment calendar, Sanadi
 * must not invent "available slots" and must not stop the journey either. It
 * offers PREFERRED times inside the approved office window (Monday–Thursday,
 * 07:00–14:00 Dubai), and the student's choice becomes a routed request that a
 * real officer confirms. A preferred time is never called available and never
 * becomes a confirmed appointment until the office accepts it.
 *
 * Mode A (published slots) and Mode B (preferred-time request) never mix:
 * Mode B is only reached when the unit has zero real open slots.
 */
import type { Lang } from "../agent-types";
import {
  APPOINTMENT_TIMEZONE,
  detectAppointmentIntent,
  dubaiParts,
  formatSlotDate,
  formatSlotTime,
} from "./appointment.server";

const TZ_OFFSET_MS = 4 * 3600_000;
const DAY_MS = 86_400_000;

/** The approved appointment-request window, in Dubai wall-clock time. */
export const PREFERRED_WINDOW = {
  /** 1 = Monday … 4 = Thursday. */
  weekdays: [1, 2, 3, 4] as number[],
  startHour: 7,
  endHour: 14,
  /** Suggested increments offered to the student. */
  hours: [9, 11, 13] as number[],
  timezone: APPOINTMENT_TIMEZONE,
};

export type PreferredTime = { start: string };

/** UTC instant for a Dubai wall-clock date and time. */
function dubaiIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(Date.UTC(year, month, day, hour, minute, 0) - TZ_OFFSET_MS).toISOString();
}

/** True when an instant falls inside Monday–Thursday, 07:00–14:00 Dubai. */
export function isWithinPreferredWindow(iso: string): boolean {
  const p = dubaiParts(iso);
  if (!PREFERRED_WINDOW.weekdays.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= PREFERRED_WINDOW.startHour * 60 && minutes <= PREFERRED_WINDOW.endHour * 60;
}

/**
 * Suggested preferred times for the period the student asked about. Nothing
 * here implies a staff member is free — these are request windows only.
 */
export function generatePreferredTimes(opts: {
  from?: string | null;
  to?: string | null;
  now?: Date;
  max?: number;
  perDay?: number;
}): PreferredTime[] {
  const now = opts.now ?? new Date();
  const earliest = new Date(Math.max(new Date(opts.from ?? now).getTime(), now.getTime() + 3600_000));
  const latest = new Date(opts.to ? new Date(opts.to).getTime() : earliest.getTime() + 14 * DAY_MS);
  const max = opts.max ?? 5;
  const perDay = opts.perDay ?? 2;

  const out: PreferredTime[] = [];
  for (let d = 0; d < 28 && out.length < max; d += 1) {
    const probe = new Date(earliest.getTime() + d * DAY_MS);
    const p = dubaiParts(probe);
    if (!PREFERRED_WINDOW.weekdays.includes(p.weekday)) continue;
    let onThisDay = 0;
    for (const hour of PREFERRED_WINDOW.hours) {
      if (out.length >= max || onThisDay >= perDay) break;
      const iso = dubaiIso(p.year, p.month, p.day, hour);
      const t = new Date(iso).getTime();
      if (t < earliest.getTime()) continue;
      if (t > latest.getTime()) continue;
      out.push({ start: iso });
      onThisDay += 1;
    }
  }
  // A very narrow requested period (a single past-cutoff day) still deserves
  // options: widen forward rather than returning nothing.
  if (!out.length && opts.to) {
    return generatePreferredTimes({ from: opts.from ?? null, to: null, now, max, perDay });
  }
  return out;
}

/**
 * A freely typed preferred time ("10:30 AM Tuesday"). Returns the instant only
 * when it is a real future time inside the approved window; an out-of-window
 * time returns `{ outside: true }` so the caller can say so plainly.
 */
export function parsePreferredTimeReply(
  text: string,
  now = new Date(),
): { start: string } | { outside: true } | null {
  const intent = detectAppointmentIntent(text, now) ?? detectAppointmentIntent(`appointment ${text}`, now);
  if (!intent || intent.hour === null) return null;
  const day = dubaiParts(intent.from);
  const iso = dubaiIso(day.year, day.month, day.day, intent.hour, intent.minute ?? 0);
  if (new Date(iso).getTime() <= now.getTime()) return null;
  return isWithinPreferredWindow(iso) ? { start: iso } : { outside: true };
}

export function preferredTimeLine(iso: string, lang: Lang, index: number): string {
  return `**${index}.** ${formatSlotDate(iso, lang)} · ${formatSlotTime(iso, lang)}`;
}

/** The Mode B offer: honest wording, never "available". */
export function buildPreferredTimesMessage(
  unitLabel: string,
  times: PreferredTime[],
  lang: Lang,
  periodLabel?: string | null,
): string {
  const ar = lang === "ar";
  const head = ar
    ? `يمكنني المساعدة في ترتيب ذلك.\n\nلم تنشر ${unitLabel} أوقات مواعيد، لكن يمكنك اختيار وقت مفضّل ضمن نافذة استقبال الطلبات لديها.\n\n${periodLabel ? `خيارات ${periodLabel}:` : "هذه بعض الخيارات:"}`
    : `I can still help arrange this.\n\n${unitLabel} has not published appointment slots, but you can choose a preferred time during its appointment window.\n\n${periodLabel ? `Here are some options for ${periodLabel}:` : "Here are some options:"}`;
  const tail = ar
    ? "اختر رقم الخيار، أو أخبرني بوقت مفضّل آخر بين 7:00 صباحاً و2:00 ظهراً من الاثنين إلى الخميس.\n\nملاحظة: الوقت المفضّل ليس موعداً مؤكداً حتى يوافق عليه المكتب المسؤول."
    : "Choose an option, or tell me another preferred time between 7:00 AM and 2:00 PM, Monday to Thursday.\n\nNote: a preferred time is not a confirmed appointment until the responsible office accepts it.";
  return [head, times.map((t, i) => preferredTimeLine(t.start, lang, i + 1)).join("\n"), tail].join("\n\n");
}

export function outsideWindowMessage(lang: Lang): string {
  return lang === "ar"
    ? "هذا الوقت خارج نافذة طلب المواعيد. يرجى اختيار يوم من الاثنين إلى الخميس بين 7:00 صباحاً و2:00 ظهراً."
    : "That falls outside the appointment request window. Please choose Monday to Thursday between 7:00 AM and 2:00 PM.";
}

/* ------------------------------------------------------------------ */
/* Creating the routed request                                         */
/* ------------------------------------------------------------------ */

export type AppointmentRequestResult = {
  requestId: string;
  caseId: string | null;
  reference: string | null;
  preferredStart: string;
  unitLabel: string | null;
  unitId: string | null;
  staffName: string | null;
  staffEmail: string | null;
  status: string;
};

/**
 * Creates the routed meeting request: a tracked case, a workload-assigned real
 * officer, the appointment-request record and both notifications. Only real
 * staff records of the responsible unit can be assigned.
 */
export async function createAppointmentRequest(opts: {
  studentId: string;
  unitCode: string | null;
  preferredStart: string;
  purpose: string | null;
  lang: Lang;
}): Promise<AppointmentRequestResult | { error: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ar = opts.lang === "ar";

  let unit: { id: string; name_en: string; name_ar: string } | null = null;
  if (opts.unitCode) {
    const { data } = await supabaseAdmin
      .from("service_units")
      .select("id, name_en, name_ar")
      .eq("code", opts.unitCode)
      .maybeSingle();
    unit = data ?? null;
  }
  const unitLabel = unit ? (ar ? unit.name_ar : unit.name_en) : null;
  const when = `${formatSlotDate(opts.preferredStart, opts.lang)} · ${formatSlotTime(opts.preferredStart, opts.lang)}`;

  const { data: caseRow, error: caseError } = await supabaseAdmin
    .from("cases")
    .insert({
      case_number: "",
      student_id: opts.studentId,
      case_type: "service_request",
      title: ar ? `طلب موعد — ${unitLabel ?? "وحدة خدمية"}` : `Appointment request — ${unitLabel ?? "service unit"}`,
      description: [
        ar ? `الوقت المفضّل: ${when}` : `Preferred time: ${when}`,
        opts.purpose ? (ar ? `السياق: ${opts.purpose}` : `Context: ${opts.purpose}`) : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: "submitted",
      urgency: "medium",
      language: opts.lang,
      service_unit_id: unit?.id ?? null,
      human_review_required: true,
      due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    })
    .select("id, case_number")
    .single();
  if (caseError) return { error: caseError.message };

  // Real staff only, chosen by live workload in the responsible unit.
  let staffId: string | null = null;
  let method: string | null = null;
  let workload: number | null = null;
  if (unit?.id) {
    const { selectAssignee, recordAssignment } = await import("@/lib/ops/assignment.server");
    const pick = await selectAssignee({ unitId: unit.id, caseId: caseRow.id });
    staffId = pick.staffId;
    method = pick.method;
    workload = pick.workload;
    if (staffId) {
      await supabaseAdmin
        .from("cases")
        .update({ assigned_to: staffId, status: "assigned" })
        .eq("id", caseRow.id);
      await recordAssignment({
        caseId: caseRow.id,
        unitId: unit.id,
        staffId,
        method: pick.method,
        workload: pick.workload,
        reason: "Appointment request routed to the responsible unit",
      });
    }
  }

  const { data: request, error: requestError } = await supabaseAdmin
    .from("appointment_requests")
    .insert({
      case_id: caseRow.id,
      student_id: opts.studentId,
      service_unit_id: unit?.id ?? null,
      appointment_mode: "PREFERRED_TIME_REQUEST",
      preferred_datetime: opts.preferredStart,
      assigned_staff_id: staffId,
      assignment_method: staffId ? method : null,
      assigned_at: staffId ? new Date().toISOString() : null,
      workload_at_assignment: workload,
      request_status: staffId ? "ASSIGNED" : "REQUESTED",
      confirmation_status: "AWAITING_OFFICE_CONFIRMATION",
      purpose: opts.purpose,
      language: opts.lang,
      reference: caseRow.case_number,
    })
    .select("id")
    .single();
  if (requestError) return { error: requestError.message };

  let staffName: string | null = null;
  let staffEmail: string | null = null;
  if (staffId) {
    const { data: person } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", staffId)
      .maybeSingle();
    staffName = person?.full_name ?? null;
    staffEmail = person?.email ?? null;
  }

  await notifyRequestParties({
    event: "appointment_request_created",
    requestId: request.id,
    studentId: opts.studentId,
    staffUserId: staffId,
    unitId: unit?.id ?? null,
    unitLabel,
    lang: opts.lang,
    when,
  });

  return {
    requestId: request.id,
    caseId: caseRow.id,
    reference: caseRow.case_number,
    preferredStart: opts.preferredStart,
    unitLabel,
    unitId: unit?.id ?? null,
    staffName,
    staffEmail,
    status: "AWAITING_OFFICE_CONFIRMATION",
  };
}

/** Best-effort in-app notifications. Email is only claimed when it is sent. */
export async function notifyRequestParties(opts: {
  event: string;
  requestId: string;
  studentId: string;
  staffUserId: string | null;
  unitId: string | null;
  unitLabel: string | null;
  lang: Lang;
  when: string;
}) {
  try {
    const { emitNotification } = await import("@/lib/ops/notify.server");
    const vars = { when: opts.when, unit: opts.unitLabel ?? "", staff_name: "" };
    await emitNotification({
      eventType: opts.event,
      entityType: "appointment_request",
      entityId: opts.requestId,
      recipientId: opts.studentId,
      language: opts.lang,
      vars,
      actionUrl: "/requests",
      serviceUnitId: opts.unitId,
      dedupeKey: `${opts.event}:${opts.requestId}:student`,
    });
    if (opts.staffUserId) {
      await emitNotification({
        eventType: opts.event,
        entityType: "appointment_request",
        entityId: opts.requestId,
        recipientId: opts.staffUserId,
        language: "en",
        vars,
        actionUrl: "/cases",
        serviceUnitId: opts.unitId,
        dedupeKey: `${opts.event}:${opts.requestId}:staff`,
      });
    }
  } catch {
    // Notification failure never breaks the request itself.
  }
}

/** Student-facing confirmation that the REQUEST (not an appointment) was sent. */
export function formatRequestSentMessage(r: AppointmentRequestResult, lang: Lang): string {
  const ar = lang === "ar";
  const when = `${formatSlotDate(r.preferredStart, lang)} · ${formatSlotTime(r.preferredStart, lang)}`;
  const lines = [
    ar ? "**تم إرسال طلب الموعد**" : "**Appointment request sent**",
    "",
    ar ? "وقتك المفضّل:" : "Your preferred time:",
    `**${when}**`,
    "",
    ar ? "الخدمة:" : "Service:",
    `**${r.unitLabel ?? (ar ? "الوحدة المسؤولة" : "Responsible unit")}**`,
    "",
    ar ? "الحالة:" : "Status:",
    ar ? "**بانتظار التأكيد**" : "**Awaiting confirmation**",
    "",
    ar
      ? "تم إبلاغ المكتب وسيؤكد هذا الوقت أو يقترح وقتاً آخر."
      : "The office has been notified and will confirm this time or suggest another one.",
    "",
    ar ? "## من يتابع طلبك" : "## Who is following up",
    "",
  ];
  if (r.staffName) {
    lines.push(ar ? "الموظف المسؤول" : "Responsible staff member", `**${r.staffName}**`, "");
  }
  if (r.unitLabel) {
    lines.push(ar ? "الوحدة" : "Unit", `**${r.unitLabel}**`, "");
  }
  if (r.staffEmail) {
    lines.push(ar ? "البريد الجامعي" : "University email", `**${r.staffEmail}**`, "");
  }
  if (r.reference) {
    lines.push(ar ? "الرقم المرجعي" : "Reference", `**${r.reference}**`, "");
  }
  lines.push(
    ar
      ? "يمكنك متابعة الطلب هنا داخل سنَدي دون الحاجة إلى تقديم أي شيء آخر."
      : "You can follow the request here in Sanadi without submitting anything else.",
  );
  return lines.join("\n");
}
