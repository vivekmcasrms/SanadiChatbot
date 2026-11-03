/**
 * Client-side wrappers for the notification operations console.
 * Replaces the old Supabase-backed serverFn's — all access control and
 * business logic now lives in Sanadi.Api.Controllers.NotificationController.
 */
import { apiFetch } from "@/lib/auth-token";

export async function getNotificationAccessFn() {
  return apiFetch<{ canView: boolean; canManage: boolean }>("/api/notifications/ops/access");
}

export type DispatchState = {
  paused: boolean;
  pause_reason: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  lease_until: string | null;
  sender_domain_status: string;
  sender_domain_reason: string | null;
  sender_domain_checked_at: string | null;
};

export type NotificationSettings = {
  emails_enabled: boolean;
  public_app_url: string;
  demo_email_mode: boolean;
  demo_redirect_email: string | null;
  digest_enabled: boolean;
  batch_size: number;
  max_retries: number;
};

export type NotificationOverview = {
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  state: DispatchState | null;
  settings: NotificationSettings | null;
  windowDays: number;
  senderDomain: {
    sender_domain_status: string;
    sender_domain_reason: string | null;
    sender_domain_checked_at: string | null;
  };
};

export async function getNotificationOverviewFn() {
  const raw = await apiFetch<Omit<NotificationOverview, "senderDomain">>("/api/notifications/ops/overview");
  return {
    ...raw,
    senderDomain: {
      sender_domain_status: raw.state?.sender_domain_status ?? "unknown",
      sender_domain_reason: raw.state?.sender_domain_reason ?? null,
      sender_domain_checked_at: raw.state?.sender_domain_checked_at ?? null,
    },
  } satisfies NotificationOverview;
}

export type ListNotificationDeliveriesInput = {
  q?: string;
  status?: string;
  severity?: string;
  page?: number;
  pageSize?: number;
};

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

export async function listNotificationDeliveriesFn(opts?: { data?: ListNotificationDeliveriesInput }) {
  const { q = "", status = "all", severity = "all", page = 1, pageSize = 20 } = opts?.data ?? {};
  const params = new URLSearchParams({ q, status, severity, page: String(page), pageSize: String(pageSize) });
  return apiFetch<{ rows: DeliveryRow[]; total: number }>(`/api/notifications/ops/deliveries?${params.toString()}`);
}

export type UpdateNotificationSettingsInput = {
  emails_enabled?: boolean;
  demo_email_mode?: boolean;
  demo_redirect_email?: string | null;
  digest_enabled?: boolean;
  public_app_url?: string;
  batch_size?: number;
};

export async function updateNotificationSettingsFn(opts: { data: UpdateNotificationSettingsInput }) {
  return apiFetch<{ ok: true }>("/api/notifications/ops/settings", {
    method: "POST",
    body: JSON.stringify({
      emailsEnabled: opts.data.emails_enabled,
      demoEmailMode: opts.data.demo_email_mode,
      demoRedirectEmail: opts.data.demo_redirect_email,
      digestEnabled: opts.data.digest_enabled,
      publicAppUrl: opts.data.public_app_url,
      batchSize: opts.data.batch_size,
    }),
  });
}

export async function setDispatchPausedFn(opts: { data: { paused: boolean; reason?: string | null } }) {
  return apiFetch<{ ok: true }>("/api/notifications/ops/dispatch-pause", {
    method: "POST",
    body: JSON.stringify({ paused: opts.data.paused, reason: opts.data.reason ?? null }),
  });
}

/**
 * No mail provider is wired into the C# API yet, so there is nothing to
 * dispatch server-side. Kept as a no-op so the console button doesn't error;
 * wire a real SMTP/email-provider + background worker to make this live.
 */
export async function runDispatchNowFn() {
  return { processed: 0, sent: 0, failed: 0, skipped: 0, note: "Email dispatch worker not configured yet." };
}

export type BroadcastRow = {
  id: string;
  title_en: string;
  title_ar: string;
  status: string;
  audience: string;
  recipient_count: number;
  created_at: string;
  sent_at: string | null;
};

export async function listEmergencyBroadcastsFn() {
  return apiFetch<BroadcastRow[]>("/api/notifications/ops/broadcasts");
}

export type CreateEmergencyBroadcastInput = {
  title_en: string;
  title_ar: string;
  message_en: string;
  message_ar: string;
  audience: "all_students" | "unit_students" | "group";
  unit_id?: string | null;
  group_code?: string | null;
  action_url?: string | null;
};

export async function createEmergencyBroadcastFn(opts: { data: CreateEmergencyBroadcastInput }) {
  return apiFetch<{ id: string }>("/api/notifications/ops/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      titleEn: opts.data.title_en,
      titleAr: opts.data.title_ar,
      messageEn: opts.data.message_en,
      messageAr: opts.data.message_ar,
      audience: opts.data.audience,
      unitId: opts.data.unit_id ?? null,
      groupCode: opts.data.group_code ?? null,
      actionUrl: opts.data.action_url ?? null,
    }),
  });
}

export async function approveEmergencyBroadcastFn(opts: { data: { id: string } }) {
  return apiFetch<{ queued: number; alreadySent: boolean }>(
    `/api/notifications/ops/broadcasts/${opts.data.id}/approve`,
    { method: "POST" },
  );
}

