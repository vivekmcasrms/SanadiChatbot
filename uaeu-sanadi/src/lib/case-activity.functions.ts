/**
 * "What Sanadi Did" — the human-readable half of the audit trail.
 *
 * The detailed technical audit stays where it is (audit_logs, agent runs, tool
 * executions, status history). This function turns the parts a student is
 * entitled to see into plain sentences: no identifiers, no model names, no
 * JSON, no tool calls. RLS on `cases` decides whether the caller may read the
 * case at all; staff names and unit names are resolved only after that check
 * passes.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type CaseActivityEvent = {
  at: string;
  en: string;
  ar: string;
  /** "sanadi" = handled automatically, "staff" = a person, "you" = the student. */
  by: "sanadi" | "staff" | "you";
  /** Who is responsible for this step, in plain words (unit or person). */
  actorEn?: string | undefined;
  actorAr?: string | undefined;
  /** Short outcome of the step, in plain words. */
  resultEn?: string | undefined;
  resultAr?: string | undefined;
};

const DONE = { en: "Completed", ar: "تم" };
const WAITING = { en: "Waiting", ar: "بالانتظار" };
const IN_PROGRESS = { en: "In progress", ar: "قيد التنفيذ" };

const STATUS_TEXT: Record<string, { en: string; ar: string; result?: { en: string; ar: string } }> = {
  draft: { en: "Request drafted", ar: "تم إنشاء مسودة الطلب", result: IN_PROGRESS },
  submitted: { en: "Request received", ar: "تم استلام الطلب", result: DONE },
  classified: { en: "Intent identified", ar: "تم تحديد نوع الطلب", result: DONE },
  routed: { en: "Routed to the responsible unit", ar: "تم توجيه الطلب إلى الوحدة المسؤولة", result: DONE },
  acknowledged: { en: "Acknowledged by the service team", ar: "أقرّ فريق الخدمة باستلام الطلب", result: DONE },
  assigned: { en: "Assigned to a responsible staff member", ar: "تم إسناده إلى موظف مسؤول", result: DONE },
  in_review: { en: "Under review", ar: "قيد المراجعة", result: IN_PROGRESS },
  in_progress: { en: "Being worked on", ar: "قيد المعالجة", result: IN_PROGRESS },
  ai_processing: { en: "Handled automatically by Sanadi", ar: "تتم معالجته آلياً بواسطة سند", result: IN_PROGRESS },
  awaiting_student: { en: "Staff requested more information", ar: "طلب فريق الخدمة معلومات إضافية", result: WAITING },
  student_confirmation: { en: "Waiting for your confirmation", ar: "بانتظار تأكيدك", result: WAITING },
  resolution_proposed: { en: "A resolution was proposed", ar: "تم اقتراح حل", result: WAITING },
  escalated: { en: "Escalated for a faster decision", ar: "تم تصعيد الطلب لاتخاذ قرار أسرع", result: IN_PROGRESS },
  on_hold: { en: "Paused", ar: "تم تعليق الطلب مؤقتاً", result: WAITING },
  waiting_external: { en: "Waiting on another department", ar: "بانتظار جهة أخرى", result: WAITING },
  transferred: { en: "Transferred to another unit", ar: "تم تحويله إلى وحدة أخرى", result: DONE },
  reopened: { en: "Reopened", ar: "تمت إعادة فتح الطلب", result: IN_PROGRESS },
  resolved: { en: "Resolved", ar: "تم حل الطلب", result: DONE },
  closed: { en: "Closed", ar: "تم إغلاق الطلب", result: DONE },
  rejected: { en: "Request not approved", ar: "لم تتم الموافقة على الطلب", result: DONE },
  withdrawn: { en: "Request withdrawn", ar: "تم سحب الطلب", result: DONE },
  duplicate: { en: "Merged with an identical request", ar: "تم دمجه مع طلب مطابق", result: DONE },
};

const AUTOMATIC = new Set(["classified", "routed", "ai_processing", "submitted", "draft"]);

export const getCaseActivityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CaseActivityEvent[]> => {
    const { data: row } = await context.supabase
      .from("cases")
      .select(
        "id, student_id, created_at, case_type, category_id, assigned_to, service_unit_id, ai_summary, ai_confidence, outcome_en, outcome_ar",
      )
      .eq("id", data.caseId)
      .maybeSingle();
    if (!row) return [];

    const [{ data: history }, { data: comments }] = await Promise.all([
      context.supabase
        .from("case_status_history")
        .select("to_status, created_at")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("case_comments")
        .select("author_id, is_info_request, created_at")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
    ]);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: unit }, { data: staff }, { data: category }, { data: receipts }, { data: notices }, { data: housingEvents }] =
      await Promise.all([
        row.service_unit_id
          ? supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", row.service_unit_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.assigned_to
          ? supabaseAdmin.from("profiles").select("full_name").eq("id", row.assigned_to).maybeSingle()
          : Promise.resolve({ data: null }),
        row.category_id
          ? supabaseAdmin.from("case_categories").select("name_en, name_ar").eq("id", row.category_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin
          .from("action_receipts")
          .select("created_at, responsible_unit_name, current_status")
          .eq("case_id", data.caseId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("notification_deliveries")
          .select("sent_at, created_at, status, channel")
          .eq("case_id", data.caseId)
          .eq("recipient_user_id", row.student_id)
          .order("created_at", { ascending: true }),
        supabaseAdmin.from("audit_logs").select("action, created_at, metadata")
          .eq("entity_type", "case").eq("entity_id", data.caseId)
          .in("action", ["hostel.submitted", "hostel.assign", "hostel.confirm", "hostel.cancel", "hostel.complete"])
          .order("created_at", { ascending: true }),
      ]);

    const unitEn = unit?.name_en ?? undefined;
    const unitAr = unit?.name_ar ?? unit?.name_en ?? undefined;
    const events: CaseActivityEvent[] = [
      {
        at: row.created_at,
        en: "Request received",
        ar: "تم استلام الطلب",
        by: "sanadi",
        actorEn: "Sanadi",
        actorAr: "سند",
        resultEn: DONE.en,
        resultAr: DONE.ar,
      },
    ];

    const housingText: Record<string, { en: string; ar: string }> = {
      "hostel.submitted": { en: "Hostel eligibility checked against verified city and academic records", ar: "تم التحقق من أهلية السكن وفق المدينة والسجل الأكاديمي الموثقين" },
      "hostel.assign": { en: "Housing staff assigned a room", ar: "حدد موظف السكن غرفة" },
      "hostel.confirm": { en: "Housing staff confirmed the booking", ar: "أكد موظف السكن الحجز" },
      "hostel.cancel": { en: "Housing staff cancelled the booking", ar: "ألغى موظف السكن الحجز" },
      "hostel.complete": { en: "Housing staff completed the request", ar: "أكمل موظف السكن الطلب" },
    };
    for (const h of housingEvents ?? []) {
      const text = housingText[h.action];
      if (!text) continue;
      const details = h.metadata && typeof h.metadata === "object" && !Array.isArray(h.metadata) ? h.metadata : {};
      const hostel = typeof details["hostel"] === "string" ? details["hostel"] : null;
      const room = typeof details["room_number"] === "string" ? details["room_number"] : null;
      events.push({ at: h.created_at, ...text, by: h.action === "hostel.submitted" ? "sanadi" : "staff",
        actorEn: unitEn, actorAr: unitAr,
        resultEn: hostel && room ? `Hostel ${hostel}, room ${room}` : DONE.en,
        resultAr: hostel && room ? `سكن ${hostel}، غرفة ${room}` : DONE.ar });
    }

    // Sanadi checked the student's verified university records before acting.
    if (row.ai_summary) {
      events.push({
        at: row.created_at,
        en: "Information retrieved from verified university records",
        ar: "تم جلب المعلومات من السجلات الجامعية الموثقة",
        by: "sanadi",
        actorEn: "Sanadi",
        actorAr: "سند",
        resultEn: DONE.en,
        resultAr: DONE.ar,
      });
    }

    for (const h of history ?? []) {
      const text = STATUS_TEXT[h.to_status];
      if (!text) continue;
      if (h.to_status === "submitted") continue; // already covered by "Request received"
      let en = text.en;
      let ar = text.ar;
      let actorEn: string | undefined;
      let actorAr: string | undefined;
      if (h.to_status === "classified" && category) {
        en = `Intent identified: ${category.name_en}`;
        ar = `تم تحديد نوع الطلب: ${category.name_ar ?? category.name_en}`;
      }
      if ((h.to_status === "routed" || h.to_status === "transferred") && unitEn) {
        en = `Routed to ${unitEn}`;
        ar = `تم توجيه الطلب إلى ${unitAr}`;
      }
      if (h.to_status === "assigned" && staff?.full_name) {
        en = `Assigned to ${staff.full_name}`;
        ar = `تم إسناده إلى ${staff.full_name}`;
      }
      if (AUTOMATIC.has(h.to_status)) {
        actorEn = "Sanadi";
        actorAr = "سند";
      } else if (h.to_status === "assigned" && staff?.full_name) {
        actorEn = staff.full_name;
        actorAr = staff.full_name;
      } else {
        actorEn = unitEn;
        actorAr = unitAr;
      }
      events.push({
        at: h.created_at,
        en,
        ar,
        by: AUTOMATIC.has(h.to_status) ? "sanadi" : "staff",
        actorEn,
        actorAr,
        resultEn: text.result?.en,
        resultAr: text.result?.ar,
      });
    }

    for (const c of comments ?? []) {
      const mine = c.author_id === row.student_id;
      events.push({
        at: c.created_at,
        en: c.is_info_request
          ? "Staff requested more information"
          : mine
            ? "You sent a message"
            : "The service team replied to you",
        ar: c.is_info_request
          ? "طلب فريق الخدمة معلومات إضافية منك"
          : mine
            ? "أرسلت رسالة"
            : "رد فريق الخدمة عليك",
        by: mine ? "you" : "staff",
        actorEn: mine ? "You" : (unitEn ?? "Service team"),
        actorAr: mine ? "أنت" : (unitAr ?? "فريق الخدمة"),
        resultEn: c.is_info_request ? WAITING.en : DONE.en,
        resultAr: c.is_info_request ? WAITING.ar : DONE.ar,
      });
    }

    // Actions Sanadi completed on the student's behalf (bookings, submissions,
    // document requests) — described by their outcome, never by tool names.
    for (const r of receipts ?? []) {
      events.push({
        at: r.created_at,
        en: "Action completed on your behalf",
        ar: "تم تنفيذ إجراء نيابة عنك",
        by: "sanadi",
        actorEn: r.responsible_unit_name ?? unitEn ?? "Sanadi",
        actorAr: r.responsible_unit_name ?? unitAr ?? "سند",
        resultEn: DONE.en,
        resultAr: DONE.ar,
      });
    }

    for (const n of notices ?? []) {
      if (n.status !== "sent" && n.status !== "delivered") continue;
      events.push({
        at: n.sent_at ?? n.created_at,
        en: "You were notified about an update",
        ar: "تم إشعارك بوجود تحديث",
        by: "sanadi",
        actorEn: "Sanadi",
        actorAr: "سند",
        resultEn: DONE.en,
        resultAr: DONE.ar,
      });
    }

    if (row.outcome_en) {
      events.push({
        at: events[events.length - 1]?.at ?? row.created_at,
        en: `Outcome: ${row.outcome_en}`,
        ar: `النتيجة: ${row.outcome_ar ?? row.outcome_en}`,
        by: "staff",
        actorEn: unitEn,
        actorAr: unitAr,
        resultEn: DONE.en,
        resultAr: DONE.ar,
      });
    }

    return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  });
