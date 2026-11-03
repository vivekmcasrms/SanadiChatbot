/**
 * Managed email delivery for Sanadi.
 *
 * All sending goes through Lovable's managed email API. Until the sender domain
 * is verified, sends resolve as `skipped` so queued deliveries stay auditable
 * instead of failing loudly.
 */
import { EmailAPIError, sendLovableEmail } from "@lovable.dev/email-js";
import { outboundAllowed } from "@/lib/environment.server";

export type SendOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "suppressed"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "retry"; reason: string; code: string | null; retryAfterSeconds: number | null }
  | { status: "failed"; reason: string; code: string | null };

const SENDER_DOMAIN = process.env["EMAIL_SENDER_DOMAIN"] ?? "";
const FROM_ADDRESS = process.env["EMAIL_FROM_ADDRESS"] ?? (SENDER_DOMAIN ? `Sanadi <no-reply@${SENDER_DOMAIN}>` : "");


export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  label?: string;
}): Promise<SendOutcome> {
  const outbound = outboundAllowed("email");
  if (!outbound.allowed) return { status: "skipped", reason: "test_environment" };

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { status: "skipped", reason: "missing_api_key" };
  if (!SENDER_DOMAIN || !FROM_ADDRESS) return { status: "skipped", reason: "missing_sender_domain" };


  try {
    const res = await sendLovableEmail(
      {
        to: params.to,
        from: FROM_ADDRESS,
        sender_domain: SENDER_DOMAIN,
        subject: params.subject,
        html: params.html,
        text: params.text,
        purpose: "transactional",
        label: params.label ?? "sanadi-notification",
        idempotency_key: params.idempotencyKey,
      },
      { apiKey, idempotencyKey: params.idempotencyKey },
    );
    if (!res.success) return { status: "failed", reason: res.status ?? "unknown_failure", code: null };
    return { status: "sent", messageId: res.message_id ?? null };
  } catch (err) {
    if (err instanceof EmailAPIError) {
      const code = err.code ?? null;
      if (code === "recipient_suppressed") return { status: "suppressed", reason: "recipient_suppressed" };
      if (code === "domain_not_verified" || code === "emails_disabled") {
        return { status: "skipped", reason: code };
      }
      if (err.status === 429) {
        return {
          status: "retry",
          reason: "rate_limited",
          code,
          retryAfterSeconds: err.retryAfterSeconds ?? 60,
        };
      }
      if (err.status >= 500) {
        return { status: "retry", reason: err.message, code, retryAfterSeconds: null };
      }
      return { status: "failed", reason: err.message, code };
    }
    return { status: "retry", reason: err instanceof Error ? err.message : "network_error", code: null, retryAfterSeconds: null };
  }
}
