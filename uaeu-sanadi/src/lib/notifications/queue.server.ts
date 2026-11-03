/**
 * Email queueing layer for Sanadi.
 *
 * Responsibilities: resolve the event catalogue entry, resolve the recipient and
 * their language + preferences, apply severity/optionality/quiet-hour/throttle
 * rules, and insert an auditable row into notification_deliveries. Sending itself
 * is asynchronous and handled by the dispatcher.
 *
 * This module never throws — a notification failure must not break a workflow.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { NotificationSeverity } from "./constants";

export type EventTypeConfig = {
  event_type: string;
  severity: NotificationSeverity;
  category: string;
  audience: string;
  email_enabled: boolean;
  student_optional: boolean;
  digest_eligible: boolean;
  admin_group_code: string | null;
  template_code: string | null;
  throttle_seconds: number;
  enabled: boolean;
};

export type QueueEmailInput = {
  eventType: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientRole?: string | null;
  language?: "en" | "ar" | null;
  vars?: Record<string, string | number | null | undefined>;
  actionPath?: string | null;
  caseId?: string | null;
  serviceUnitId?: string | null;
  notificationEventId?: string | null;
  dedupeKey?: string | null;
  emergencyBroadcastId?: string | null;
  /** Bypass optional-preference checks (used by approved emergency broadcasts). */
  force?: boolean;
};

export type QueueResult = { queued: boolean; reason?: string };

type Settings = {
  emails_enabled: boolean;
  public_app_url: string;
  demo_email_mode: boolean;
  demo_redirect_email: string | null;
  digest_enabled: boolean;
  max_retries: number;
  batch_size: number;
};

let catalogueCache: { at: number; map: Map<string, EventTypeConfig> } | null = null;
let settingsCache: { at: number; value: Settings } | null = null;
const CACHE_MS = 60_000;

export async function getEventCatalogue(): Promise<Map<string, EventTypeConfig>> {
  if (catalogueCache && Date.now() - catalogueCache.at < CACHE_MS) return catalogueCache.map;
  const { data } = await supabaseAdmin
    .from("notification_event_types")
    .select(
      "event_type, severity, category, audience, email_enabled, student_optional, digest_eligible, admin_group_code, template_code, throttle_seconds, enabled",
    );
  const map = new Map<string, EventTypeConfig>();
  for (const row of (data ?? []) as EventTypeConfig[]) map.set(row.event_type, row);
  catalogueCache = { at: Date.now(), map };
  return map;
}

export async function getNotificationSettings(): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache.value;
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("emails_enabled, public_app_url, demo_email_mode, demo_redirect_email, digest_enabled, max_retries, batch_size")
    .eq("id", true)
    .maybeSingle();
  const value: Settings = {
    emails_enabled: data?.emails_enabled ?? true,
    public_app_url: data?.public_app_url ?? process.env["PUBLIC_APP_URL"] ?? "http://localhost:8080",
    demo_email_mode: data?.demo_email_mode ?? true,
    demo_redirect_email: data?.demo_redirect_email ?? null,
    digest_enabled: data?.digest_enabled ?? true,
    max_retries: data?.max_retries ?? 3,
    batch_size: data?.batch_size ?? 25,
  };
  settingsCache = { at: Date.now(), value };
  return value;
}

export function invalidateNotificationCaches() {
  catalogueCache = null;
  settingsCache = null;
}

export function absoluteUrl(baseUrl: string, path: string | null | undefined): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

type Recipient = {
  userId: string | null;
  email: string | null;
  name: string;
  language: "en" | "ar";
  role: string | null;
  prefs: {
    email: boolean;
    optional_email_categories: string[];
    digest_enabled: boolean;
    immediate_critical: boolean;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
  } | null;
};

async function resolveRecipient(input: QueueEmailInput): Promise<Recipient | null> {
  if (!input.recipientUserId) {
    if (!input.recipientEmail) return null;
    return {
      userId: null,
      email: input.recipientEmail,
      name: input.recipientEmail.split("@")[0] ?? "",
      language: input.language ?? "en",
      role: input.recipientRole ?? null,
      prefs: null,
    };
  }

  const [{ data: profile }, { data: prefs }, { data: roles }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, preferred_language, deleted_at")
      .eq("id", input.recipientUserId)
      .maybeSingle(),
    supabaseAdmin
      .from("notification_preferences")
      .select("email, optional_email_categories, digest_enabled, immediate_critical, quiet_hours_start, quiet_hours_end")
      .eq("user_id", input.recipientUserId)
      .maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", input.recipientUserId).limit(1),
  ]);

  if (!profile || profile.deleted_at) return null;

  return {
    userId: profile.id,
    email: input.recipientEmail ?? profile.email ?? null,
    name: profile.full_name ?? "",
    language: (input.language ?? (profile.preferred_language as "en" | "ar" | null) ?? "en") as "en" | "ar",
    role: input.recipientRole ?? roles?.[0]?.role ?? null,
    prefs: prefs
      ? {
          email: prefs.email,
          optional_email_categories: prefs.optional_email_categories ?? [],
          digest_enabled: prefs.digest_enabled ?? true,
          immediate_critical: prefs.immediate_critical ?? true,
          quiet_hours_start: prefs.quiet_hours_start,
          quiet_hours_end: prefs.quiet_hours_end,
        }
      : null,
  };
}

/** Returns the delay (ms) to hold a non-urgent email until quiet hours end, or 0. */
function quietHoursDelayMs(recipient: Recipient, severity: NotificationSeverity): number {
  if (severity === "critical" || severity === "emergency") return 0;
  const start = recipient.prefs?.quiet_hours_start;
  const end = recipient.prefs?.quiet_hours_end;
  if (!start || !end) return 0;
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes() + 240; // Gulf Standard Time (UTC+4)
  const nowMin = mins % 1440;
  const toMin = (v: string) => {
    const [h = "0", m = "0"] = v.split(":");
    return Number(h) * 60 + Number(m);
  };
  const s = toMin(start);
  const e = toMin(end);
  const inQuiet = s <= e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
  if (!inQuiet) return 0;
  const untilEnd = e > nowMin ? e - nowMin : 1440 - nowMin + e;
  return untilEnd * 60_000;
}

/**
 * Queue one email delivery. Idempotent through dedupeKey.
 */
export async function queueEmail(input: QueueEmailInput): Promise<QueueResult> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.emails_enabled) return { queued: false, reason: "emails_disabled" };

    const catalogue = await getEventCatalogue();
    const config = catalogue.get(input.eventType);
    if (!config || !config.enabled || !config.email_enabled) {
      return { queued: false, reason: "event_not_email_enabled" };
    }
    const template = config.template_code;
    if (!template) return { queued: false, reason: "no_template" };

    const recipient = await resolveRecipient(input);
    if (!recipient?.email) return { queued: false, reason: "no_recipient_email" };

    const severity = config.severity;
    const urgent = severity === "critical" || severity === "emergency";

    if (!input.force && recipient.prefs) {
      if (!recipient.prefs.email && !urgent) return { queued: false, reason: "email_channel_off" };
      if (
        config.student_optional &&
        !urgent &&
        !recipient.prefs.optional_email_categories.includes(config.category)
      ) {
        return { queued: false, reason: "category_opted_out" };
      }
      if (
        config.digest_eligible &&
        severity === "normal" &&
        settings.digest_enabled &&
        recipient.prefs.digest_enabled
      ) {
        return { queued: false, reason: "deferred_to_digest" };
      }
    }

    // Throttle repeated notifications of the same type to the same recipient.
    if (config.throttle_seconds > 0 && recipient.userId) {
      const since = new Date(Date.now() - config.throttle_seconds * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("notification_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", recipient.userId)
        .eq("event_type", input.eventType)
        .gte("created_at", since);
      if ((count ?? 0) > 0) return { queued: false, reason: "throttled" };
    }

    const delay = quietHoursDelayMs(recipient, severity);
    const nextAttempt = new Date(Date.now() + delay).toISOString();

    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.vars ?? {})) {
      if (v === null || v === undefined) continue;
      vars[k] = String(v).slice(0, 600);
    }
    vars["recipient_name"] = vars["recipient_name"] ?? recipient.name;

    const actionUrl = absoluteUrl(settings.public_app_url, input.actionPath ?? "/");

    const { error } = await supabaseAdmin.from("notification_deliveries").insert({
      notification_event_id: input.notificationEventId ?? null,
      event_type: input.eventType,
      severity,
      recipient_user_id: recipient.userId,
      recipient_email: recipient.email,
      recipient_role: recipient.role,
      channel: "email",
      language: recipient.language,
      template_code: template,
      template_vars: vars,
      action_url: actionUrl,
      case_id: input.caseId ?? null,
      service_unit_id: input.serviceUnitId ?? null,
      emergency_broadcast_id: input.emergencyBroadcastId ?? null,
      status: "queued",
      next_attempt_at: nextAttempt,
      dedupe_key: input.dedupeKey ?? null,
    });

    if (error) {
      if (error.code === "23505") return { queued: false, reason: "duplicate" };
      console.error("[notify-email] queue failed", error.message);
      return { queued: false, reason: "insert_error" };
    }
    return { queued: true };
  } catch (err) {
    console.error("[notify-email] unexpected", err);
    return { queued: false, reason: "unexpected" };
  }
}

/** Queue an email to every active member of a configured distribution group. */
export async function queueGroupEmail(
  groupCode: string,
  input: Omit<QueueEmailInput, "recipientUserId" | "recipientEmail">,
): Promise<number> {
  const { data: group } = await supabaseAdmin
    .from("notification_groups")
    .select("code, enabled")
    .eq("code", groupCode)
    .maybeSingle();
  if (!group?.enabled) return 0;

  const { data: members } = await supabaseAdmin
    .from("notification_group_members")
    .select("user_id, email")
    .eq("group_code", groupCode)
    .eq("is_active", true)
    .limit(200);

  let queued = 0;
  for (const member of members ?? []) {
    const res = await queueEmail({
      ...input,
      recipientUserId: member.user_id,
      recipientEmail: member.user_id ? null : member.email,
      recipientRole: "admin",
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${member.user_id ?? member.email}` : null,
    });
    if (res.queued) queued += 1;
  }
  return queued;
}
