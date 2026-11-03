/** Server-only logic behind the notification operations console. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { invalidateNotificationCaches, queueEmail } from "./queue.server";

export type OpsAccess = { canView: boolean; canManage: boolean };

const MAX_BROADCAST_RECIPIENTS = 2000;

export async function resolveOpsAccess(supabase: {
  rpc: (fn: "has_role", args: { _user_id: string; _role: string }) => Promise<{ data: unknown }>;
}, userId: string): Promise<OpsAccess> {
  const [admin, manager, leadership, auditor] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "service_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "leadership_viewer" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "auditor" }),
  ]);
  const canManage = admin.data === true;
  const canView = canManage || manager.data === true || leadership.data === true || auditor.data === true;
  return { canView, canManage };
}

export function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? "***" : ""}@${domain}`;
}

export type DeliveryRow = {
  id: string;
  event_type: string;
  severity: string;
  status: string;
  language: string;
  template_code: string;
  recipient_masked: string;
  recipient_role: string | null;
  subject: string | null;
  retry_count: number;
  failure_code: string | null;
  failure_reason: string | null;
  queued_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
};

export async function listDeliveries(params: {
  q: string;
  status: string;
  severity: string;
  page: number;
  pageSize: number;
}) {
  let query = supabaseAdmin
    .from("notification_deliveries")
    .select(
      "id, event_type, severity, status, language, template_code, recipient_email, recipient_role, subject, retry_count, failure_code, failure_reason, queued_at, sent_at, next_attempt_at",
      { count: "exact" },
    )
    .order("queued_at", { ascending: false });

  if (params.status !== "all") query = query.eq("status", params.status);
  if (params.severity !== "all") query = query.eq("severity", params.severity as "normal" | "important" | "critical" | "emergency");
  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`event_type.ilike.${term},subject.ilike.${term},recipient_email.ilike.${term}`);
  }

  const from = (params.page - 1) * params.pageSize;
  const { data, count, error } = await query.range(from, from + params.pageSize - 1);
  if (error) throw new Error(error.message);

  const rows: DeliveryRow[] = (data ?? []).map((row) => ({
    id: row.id,
    event_type: row.event_type,
    severity: row.severity,
    status: row.status,
    language: row.language,
    template_code: row.template_code,
    recipient_masked: maskEmail(row.recipient_email),
    recipient_role: row.recipient_role,
    subject: row.subject,
    retry_count: row.retry_count,
    failure_code: row.failure_code,
    failure_reason: row.failure_reason,
    queued_at: row.queued_at,
    sent_at: row.sent_at,
    next_attempt_at: row.next_attempt_at,
  }));

  return { rows, total: count ?? 0 };
}

export type SenderDomainHealth = {
  sender_domain_status: string;
  sender_domain_reason: string | null;
  sender_domain_checked_at: string | null;
};

export async function getOpsOverview() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [{ data: recent }, { data: state }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("notification_deliveries")
      .select("status, severity")
      .gte("queued_at", since)
      .limit(5000),
    supabaseAdmin
      .from("notification_dispatch_state")
      .select("paused, pause_reason, last_run_at, consecutive_failures, lease_until")
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin
      .from("notification_settings")
      .select("emails_enabled, public_app_url, demo_email_mode, demo_redirect_email, digest_enabled, batch_size, max_retries")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const row of recent ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
  }

  // Sender-domain health lives on the same row; selected loosely because the
  // generated types lag behind the migration that added these columns.
  const { data: domainRow } = await (supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: boolean) => { maybeSingle: () => Promise<{ data: SenderDomainHealth | null }> };
      };
    };
  })
    .from("notification_dispatch_state")
    .select("sender_domain_status, sender_domain_reason, sender_domain_checked_at")
    .eq("id", true)
    .maybeSingle();

  const senderDomain: SenderDomainHealth = domainRow ?? {
    sender_domain_status: "unknown",
    sender_domain_reason: null,
    sender_domain_checked_at: null,
  };

  return { byStatus, bySeverity, state, settings, senderDomain, windowDays: 7 };
}

export type SettingsPatch = {
  emails_enabled?: boolean | undefined;
  public_app_url?: string | undefined;
  demo_email_mode?: boolean | undefined;
  demo_redirect_email?: string | null | undefined;
  digest_enabled?: boolean | undefined;
  batch_size?: number | undefined;
  max_retries?: number | undefined;
};

export async function updateSettings(patch: SettingsPatch) {
  const { error } = await supabaseAdmin.from("notification_settings").update(patch as never).eq("id", true);
  if (error) throw new Error(error.message);
  invalidateNotificationCaches();
}

export async function setDispatchPaused(paused: boolean, reason: string | null) {
  const { error } = await supabaseAdmin
    .from("notification_dispatch_state")
    .update({
      paused,
      pause_reason: paused ? reason : null,
      paused_at: paused ? new Date().toISOString() : null,
      ...(paused ? {} : { consecutive_failures: 0 }),
      lease_until: null,
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** Fan out an approved emergency broadcast. Bounded, deduplicated, fully audited. */
export async function sendEmergencyBroadcast(broadcastId: string, approverId: string) {
  const { data: broadcast } = await supabaseAdmin
    .from("emergency_broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .maybeSingle();
  if (!broadcast) throw new Error("Broadcast not found");
  if (broadcast.status === "sent" || broadcast.status === "sending") {
    return { queued: broadcast.recipient_count, alreadySent: true };
  }

  const config = (broadcast.audience_config ?? {}) as { unit_id?: string; group_code?: string };
  let recipientIds: string[] = [];

  if (broadcast.audience === "all_students") {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "student")
      .limit(MAX_BROADCAST_RECIPIENTS);
    recipientIds = (data ?? []).map((r) => r.user_id);
  } else if (broadcast.audience === "unit_students" && config.unit_id) {
    const { data } = await supabaseAdmin
      .from("cases")
      .select("student_id")
      .eq("service_unit_id", config.unit_id)
      .limit(MAX_BROADCAST_RECIPIENTS);
    recipientIds = Array.from(new Set((data ?? []).map((r) => r.student_id).filter(Boolean) as string[]));
  } else if (broadcast.audience === "group" && config.group_code) {
    const { data } = await supabaseAdmin
      .from("notification_group_members")
      .select("user_id")
      .eq("group_code", config.group_code)
      .eq("is_active", true)
      .limit(MAX_BROADCAST_RECIPIENTS);
    recipientIds = (data ?? []).map((r) => r.user_id).filter(Boolean) as string[];
  }

  await supabaseAdmin
    .from("emergency_broadcasts")
    .update({ status: "sending", approved_by: approverId, approved_at: new Date().toISOString() })
    .eq("id", broadcastId);

  let queued = 0;
  for (const userId of recipientIds.slice(0, MAX_BROADCAST_RECIPIENTS)) {
    const res = await queueEmail({
      eventType: "EMERGENCY_ALERT",
      recipientUserId: userId,
      force: true,
      actionPath: broadcast.action_url ?? "/alerts",
      emergencyBroadcastId: broadcastId,
      dedupeKey: `broadcast:${broadcastId}:${userId}`,
      vars: {
        alert_title: broadcast.title_en,
        alert_title_ar: broadcast.title_ar,
        approved_emergency_message: broadcast.message_en,
        approved_emergency_message_ar: broadcast.message_ar,
      },
    });
    if (res.queued) queued += 1;
  }

  await supabaseAdmin
    .from("emergency_broadcasts")
    .update({ status: "sent", sent_at: new Date().toISOString(), recipient_count: queued })
    .eq("id", broadcastId);

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: approverId,
    action: "emergency_broadcast_sent",
    entity_type: "emergency_broadcast",
    entity_id: broadcastId,
    metadata: { recipients: queued, audience: broadcast.audience },
  });

  return { queued, alreadySent: false };
}
