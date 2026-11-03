/** Event-driven notification engine. Idempotent through dedupe keys. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IN_APP_TO_EMAIL_EVENT } from "@/lib/notifications/constants";
import { queueEmail } from "@/lib/notifications/queue.server";

export type NotifyInput = {
  eventType: string;
  entityType: string;
  entityId: string;
  recipientId: string | null | undefined;
  vars?: Record<string, string | number | null | undefined>;
  actionUrl?: string | null;
  channels?: string[];
  dedupeKey?: string | null;
  language?: "en" | "ar";
  /** Explicit email event type; defaults to the mapping for eventType. */
  emailEventType?: string | null;
  /** Set false to keep this notification strictly in-app. */
  email?: boolean;
  caseId?: string | null;
  serviceUnitId?: string | null;
};


function render(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(vars[key] ?? ""));
}

const FALLBACK: Record<string, { en: string; ar: string }> = {
  case_submitted: { en: "Request {{case_number}} received", ar: "تم استلام الطلب {{case_number}}" },
  case_acknowledged: { en: "Request {{case_number}} acknowledged", ar: "تم الإقرار بالطلب {{case_number}}" },
  case_assigned: {
    en: "Request {{case_number}} is with {{unit}} — {{staff_name}} ({{staff_email}}) is following it up",
    ar: "طلبك {{case_number}} لدى {{unit}} — يتابعه {{staff_name}} ({{staff_email}})",
  },
  case_status_changed: { en: "Request {{case_number}} is now {{status}}", ar: "حالة الطلب {{case_number}}: {{status}}" },
  information_requested: { en: "More information needed for {{case_number}}", ar: "مطلوب معلومات إضافية للطلب {{case_number}}" },
  information_provided: { en: "Student responded on {{case_number}}", ar: "رد الطالب على الطلب {{case_number}}" },
  case_escalated: { en: "Request {{case_number}} escalated to level {{level}}", ar: "تم تصعيد الطلب {{case_number}} إلى المستوى {{level}}" },
  resolution_proposed: { en: "A resolution is proposed for {{case_number}}", ar: "تم اقتراح حل للطلب {{case_number}}" },
  case_resolved: { en: "Request {{case_number}} resolved", ar: "تم حل الطلب {{case_number}}" },
  case_closed: { en: "Request {{case_number}} closed", ar: "تم إغلاق الطلب {{case_number}}" },
  case_reopened: { en: "Request {{case_number}} reopened", ar: "تمت إعادة فتح الطلب {{case_number}}" },
  case_delayed: { en: "Request {{case_number}} is delayed — new expected date {{due}}", ar: "تأخر الطلب {{case_number}} — الموعد المتوقع الجديد {{due}}" },
  sla_warning: { en: "{{case_number}} is approaching its deadline", ar: "يقترب الطلب {{case_number}} من الموعد النهائي" },
  sla_overdue: { en: "{{case_number}} is overdue", ar: "تجاوز الطلب {{case_number}} الموعد النهائي" },
  approval_assigned: { en: "Approval required: {{summary}}", ar: "مطلوب اعتماد: {{summary}}" },
  approval_completed: { en: "Approval {{status}}: {{summary}}", ar: "الاعتماد {{status}}: {{summary}}" },
  suggestion_status_changed: { en: "Suggestion {{reference}} is now {{status}}", ar: "حالة الاقتراح {{reference}}: {{status}}" },
  alert_generated: { en: "{{title}}", ar: "{{title}}" },
  satisfaction_survey: { en: "How did we do on {{case_number}}?", ar: "ما رأيك في خدمتنا للطلب {{case_number}}؟" },
  service_window_open: { en: "{{service}} is now open — you can continue with Sanadi", ar: "{{service}} مفتوحة الآن — يمكنك المتابعة مع سندي" },
  appointment_booked: {
    en: "Appointment confirmed — {{when}} with {{staff_name}} ({{unit}})",
    ar: "تم تأكيد الموعد — {{when}} مع {{staff_name}} ({{unit}})",
  },
  appointment_changed: {
    en: "Appointment moved to {{when}} with {{staff_name}} ({{unit}})",
    ar: "تم نقل الموعد إلى {{when}} مع {{staff_name}} ({{unit}})",
  },
  appointment_cancelled: {
    en: "Appointment on {{when}} with {{unit}} was cancelled",
    ar: "تم إلغاء الموعد بتاريخ {{when}} مع {{unit}}",
  },
  appointment_reminder: {
    en: "Reminder: your appointment is {{when}} with {{staff_name}} ({{unit}}) — {{location}}",
    ar: "تذكير: موعدك {{when}} مع {{staff_name}} ({{unit}}) — {{location}}",
  },
  new_assignment: { en: "New case assigned to you: {{case_number}}", ar: "تم إسناد حالة جديدة إليك: {{case_number}}" },
  urgent_assignment: {
    en: "URGENT — {{urgency}} {{case_type}} assigned to you: {{case_number}} — {{title}}. Reported {{reported_at}}{{location}} · Unit: {{unit}} · Action required: acknowledge and respond now.",
    ar: "عاجل — {{case_type}} بأولوية {{urgency}} مُسند إليك: {{case_number}} — {{title}}. تم الإبلاغ {{reported_at}}{{location}} · الوحدة: {{unit}} · الإجراء المطلوب: الإقرار والاستجابة فوراً.",
  },
  student_response_received: { en: "Student replied on {{case_number}}", ar: "رد الطالب على {{case_number}}" },
  case_meeting_set: {
    en: "Meeting set for {{case_number}} — {{when}} ({{mode}}) with {{staff_name}} ({{unit}}) {{location}}",
    ar: "تم تحديد لقاء للطلب {{case_number}} — {{when}} ({{mode}}) مع {{staff_name}} ({{unit}}) {{location}}",
  },
  case_meeting_cancelled: {
    en: "The meeting for request {{case_number}} was cancelled — you will be told if a new time is set",
    ar: "تم إلغاء اللقاء الخاص بالطلب {{case_number}} — سيتم إبلاغك عند تحديد موعد جديد",
  },
  document_ready: {
    en: "Your official letter {{reference}} is ready to view and download",
    ar: "خطابك الرسمي {{reference}} جاهز للعرض والتنزيل",
  },
};

/**
 * Queue a notification. Never throws — notification failures must not break workflow.
 * dedupeKey makes repeated scheduled-job runs idempotent.
 */
export async function emitNotification(input: NotifyInput): Promise<boolean> {
  if (!input.recipientId) return false;
  const lang = input.language ?? "en";
  const vars = input.vars ?? {};
  const channels = input.channels ?? ["in_app"];

  try {
    const { data: tpl } = await supabaseAdmin
      .from("notification_templates")
      .select("id, subject_template, body_template, action_label_template, channel")
      .eq("event_type", input.eventType)
      .eq("language", lang)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fallback = FALLBACK[input.eventType] ?? { en: input.eventType, ar: input.eventType };
    const title = tpl ? render(tpl.subject_template, vars) : render(fallback[lang], vars);
    const body = tpl ? render(tpl.body_template, vars) : title;

    const emailEventType = input.emailEventType ?? IN_APP_TO_EMAIL_EVENT[input.eventType] ?? null;

    const rows = channels.map((channel) => ({
      event_type: input.eventType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      recipient_profile_id: input.recipientId!,
      template_id: tpl?.id ?? null,
      channel,
      title,
      body,
      action_url: input.actionUrl ?? null,
      payload: vars as unknown as Record<string, string>,
      status: channel === "in_app" ? "delivered" : "logged",
      processed_at: new Date().toISOString(),
      case_id: input.caseId ?? null,
      service_unit_id: input.serviceUnitId ?? null,
      dedupe_key: input.dedupeKey ? `${input.dedupeKey}:${channel}` : null,
    }));

    const { data: inserted, error } = await supabaseAdmin
      .from("notification_events")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error && error.code !== "23505") {
      console.error("[notify] insert failed", error.message);
      const { logException } = await import("@/lib/exceptions/handle.server");
      await logException("notification_failure", {
        userId: input.recipientId ?? null,
        caseId: input.caseId ?? null,
        detail: error.message,
        recoveryAction: "in_app_history_remains_source_of_truth",
      });
      return false;
    }

    // Escalate to email when the event catalogue marks this event as email-worthy.
    // Deduplicated on the in-app dedupe key so repeated job runs never resend.
    const isDuplicate = Boolean(input.dedupeKey) && (inserted?.length ?? 0) === 0;
    if (emailEventType && input.email !== false && !isDuplicate) {
      await queueEmail({
        eventType: emailEventType,
        recipientUserId: input.recipientId,
        language: lang,
        vars: { ...vars, headline: title, message: body },
        actionPath: input.actionUrl ?? null,
        caseId: input.caseId ?? null,
        serviceUnitId: input.serviceUnitId ?? null,
        notificationEventId: inserted?.[0]?.id ?? null,
        dedupeKey: input.dedupeKey ? `email:${input.dedupeKey}:${input.recipientId}` : null,
      });
    }
    return true;

  } catch (err) {
    console.error("[notify] unexpected", err);
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("notification_failure", {
      userId: input.recipientId ?? null,
      caseId: input.caseId ?? null,
      detail: String(err),
    });
    return false;
  }
}

/** Notify every manager + the assigned officer of a unit. */
export async function notifyUnitStaff(
  unitId: string | null,
  assigneeId: string | null,
  input: Omit<NotifyInput, "recipientId">,
) {
  const recipients = new Set<string>();
  if (assigneeId) recipients.add(assigneeId);
  if (unitId) {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("user_id")
      .eq("service_unit_id", unitId)
      .limit(50);
    for (const s of data ?? []) recipients.add(s.user_id);
  }
  for (const id of recipients) {
    await emitNotification({ ...input, recipientId: id, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${id}` : null });
  }
}