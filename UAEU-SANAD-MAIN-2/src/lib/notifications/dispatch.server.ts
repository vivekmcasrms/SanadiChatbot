/**
 * Asynchronous email dispatcher.
 *
 * Bounded batch per run, a database lease so only one worker sends at a time,
 * idempotent per-delivery progress marking, exponential retry, and a circuit
 * breaker that pauses the whole pipeline after repeated provider failures.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getNotificationSettings, queueGroupEmail } from "./queue.server";
import { renderEmail, renderVars } from "./render.server";
import { sendEmail } from "./provider.server";

const LEASE_MS = 120_000;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000];
const FAILURE_PAUSE_THRESHOLD = 10;

type TemplateRow = {
  template_code: string;
  version: number;
  subject_en: string;
  subject_ar: string;
  body_en: string;
  body_ar: string;
  cta_label_en: string | null;
  cta_label_ar: string | null;
  enabled: boolean;
};

async function loadTemplates(): Promise<Map<string, TemplateRow>> {
  const { data } = await supabaseAdmin
    .from("email_templates")
    .select("template_code, version, subject_en, subject_ar, body_en, body_ar, cta_label_en, cta_label_ar, enabled")
    .eq("enabled", true)
    .order("version", { ascending: true });
  const map = new Map<string, TemplateRow>();
  for (const row of (data ?? []) as TemplateRow[]) map.set(row.template_code, row);
  return map;
}

async function acquireLease(): Promise<boolean> {
  const now = new Date();
  const { data } = await supabaseAdmin
    .from("notification_dispatch_state")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), last_run_at: now.toISOString() })
    .eq("id", true)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

/**
 * Records whether the managed email provider currently accepts our sender domain.
 * Surfaced verbatim in Admin Email Ops so a blocked domain is never silent.
 */
async function recordSenderDomain(status: "verified" | "blocked", reason: string | null) {
  await (supabaseAdmin as unknown as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => { eq: (k: string, v: boolean) => Promise<unknown> };
    };
  })
    .from("notification_dispatch_state")
    .update({
      sender_domain_status: status,
      sender_domain_reason: reason,
      sender_domain_checked_at: new Date().toISOString(),
    })
    .eq("id", true);
}

async function releaseLease(consecutiveFailures: number, pause: { reason: string } | null) {
  await supabaseAdmin
    .from("notification_dispatch_state")
    .update({
      lease_until: null,
      consecutive_failures: consecutiveFailures,
      ...(pause ? { paused: true, pause_reason: pause.reason, paused_at: new Date().toISOString() } : {}),
    })
    .eq("id", true);
}

export type DispatchResult = {
  ran: boolean;
  reason?: string;
  processed: number;
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
  suppressed: number;
};

export async function dispatchQueuedEmails(): Promise<DispatchResult> {
  const empty: DispatchResult = { ran: false, processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, suppressed: 0 };

  const settings = await getNotificationSettings();
  if (!settings.emails_enabled) return { ...empty, reason: "emails_disabled" };

  const { data: state } = await supabaseAdmin
    .from("notification_dispatch_state")
    .select("paused, pause_reason, consecutive_failures")
    .eq("id", true)
    .maybeSingle();
  if (state?.paused) return { ...empty, reason: `paused:${state.pause_reason ?? "unknown"}` };

  if (!(await acquireLease())) return { ...empty, reason: "lease_held" };

  const result: DispatchResult = { ...empty, ran: true };
  let consecutiveFailures = state?.consecutive_failures ?? 0;
  let pause: { reason: string } | null = null;
  let domainRecorded = false;

  try {
    const { data: claimed, error } = await supabaseAdmin.rpc("claim_notification_deliveries", {
      _limit: settings.batch_size,
    });
    if (error) {
      console.error("[dispatch] claim failed", error.message);
      return result;
    }

    const rows = (claimed ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return result;

    const templates = await loadTemplates();

    for (const row of rows) {
      result.processed += 1;
      const id = row["id"] as string;
      const language = ((row["language"] as string) === "ar" ? "ar" : "en") as "en" | "ar";
      const severity = (row["severity"] as string) ?? "important";
      const vars = (row["template_vars"] as Record<string, string>) ?? {};
      const actionUrl = (row["action_url"] as string | null) ?? null;
      const template = templates.get(row["template_code"] as string);

      if (!template) {
        await supabaseAdmin
          .from("notification_deliveries")
          .update({ status: "skipped", failure_code: "template_missing", failed_at: new Date().toISOString() })
          .eq("id", id);
        result.skipped += 1;
        continue;
      }

      const primary = {
        subject: renderVars(language === "ar" ? template.subject_ar : template.subject_en, vars),
        body: renderVars(language === "ar" ? template.body_ar : template.body_en, vars),
        cta: language === "ar" ? template.cta_label_ar : template.cta_label_en,
      };
      const bilingual =
        severity === "emergency"
          ? {
              subject: renderVars(language === "ar" ? template.subject_en : template.subject_ar, vars),
              body: renderVars(language === "ar" ? template.body_en : template.body_ar, vars),
            }
          : null;

      const rendered = renderEmail({
        language,
        subject: primary.subject,
        body: primary.body,
        ctaLabel: primary.cta,
        actionUrl,
        severity,
        appUrl: settings.public_app_url,
        bilingualBody: bilingual,
      });

      const realRecipient = (row["recipient_email"] as string | null) ?? "";
      const to = settings.demo_email_mode ? settings.demo_redirect_email ?? "" : realRecipient;

      if (!to) {
        await supabaseAdmin
          .from("notification_deliveries")
          .update({
            status: "skipped",
            subject: rendered.subject,
            failure_code: settings.demo_email_mode ? "demo_mode_no_redirect" : "no_recipient",
            failed_at: new Date().toISOString(),
          })
          .eq("id", id);
        result.skipped += 1;
        continue;
      }

      const outcome = await sendEmail({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: id,
        label: `sanadi-${row["event_type"] as string}`,
      });

      const nowIso = new Date().toISOString();
      const retryCount = (row["retry_count"] as number) ?? 0;

      if (outcome.status === "sent") {
        consecutiveFailures = 0;
        if (!domainRecorded) {
          domainRecorded = true;
          await recordSenderDomain("verified", null);
        }
        await supabaseAdmin
          .from("notification_deliveries")
          .update({
            status: "sent",
            subject: rendered.subject,
            sent_at: nowIso,
            provider_message_id: outcome.messageId,
            template_version: template.version,
            failure_code: null,
            failure_reason: null,
          })
          .eq("id", id);
        result.sent += 1;
      } else if (outcome.status === "suppressed") {
        await supabaseAdmin
          .from("notification_deliveries")
          .update({ status: "suppressed", subject: rendered.subject, failure_code: outcome.reason, failed_at: nowIso })
          .eq("id", id);
        result.suppressed += 1;
      } else if (outcome.status === "skipped") {
        if (
          !domainRecorded &&
          (outcome.reason === "domain_not_verified" || outcome.reason === "emails_disabled")
        ) {
          domainRecorded = true;
          await recordSenderDomain("blocked", outcome.reason);
        }
        await supabaseAdmin
          .from("notification_deliveries")
          .update({ status: "skipped", subject: rendered.subject, failure_code: outcome.reason, failed_at: nowIso })
          .eq("id", id);
        result.skipped += 1;
      } else if (outcome.status === "retry" && retryCount + 1 < settings.max_retries) {
        const wait =
          outcome.retryAfterSeconds != null
            ? outcome.retryAfterSeconds * 1000
            : RETRY_BACKOFF_MS[Math.min(retryCount, RETRY_BACKOFF_MS.length - 1)]!;
        consecutiveFailures += 1;
        await supabaseAdmin
          .from("notification_deliveries")
          .update({
            status: "retrying",
            subject: rendered.subject,
            retry_count: retryCount + 1,
            next_attempt_at: new Date(Date.now() + wait).toISOString(),
            failure_code: outcome.code,
            failure_reason: outcome.reason.slice(0, 500),
          })
          .eq("id", id);
        result.retried += 1;
      } else {
        consecutiveFailures += 1;
        await supabaseAdmin
          .from("notification_deliveries")
          .update({
            status: "failed",
            subject: rendered.subject,
            retry_count: retryCount + 1,
            failed_at: nowIso,
            failure_code: outcome.status === "retry" ? outcome.code : outcome.code,
            failure_reason: outcome.reason.slice(0, 500),
          })
          .eq("id", id);
        result.failed += 1;

        // Escalate persistent delivery failures to the operations administrators.
        await queueGroupEmail("ops_admins", {
          eventType: "EMAIL_DELIVERY_FAILURE",
          vars: {
            headline: "Email delivery failure",
            message: `Delivery of "${row["event_type"] as string}" failed after ${retryCount + 1} attempts.`,
            severity: "critical",
          },
          actionPath: "/notifications",
          dedupeKey: `email-failure:${row["event_type"] as string}:${nowIso.slice(0, 10)}`,
        });
      }

      if (consecutiveFailures >= FAILURE_PAUSE_THRESHOLD) {
        pause = { reason: `Provider failures reached ${consecutiveFailures} consecutive attempts` };
        break;
      }
    }

    return result;
  } catch (err) {
    console.error("[dispatch] unexpected", err);
    return result;
  } finally {
    await releaseLease(consecutiveFailures, pause);
  }
}
