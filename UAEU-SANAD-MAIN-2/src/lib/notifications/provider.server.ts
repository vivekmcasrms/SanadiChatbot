/**
 * Outbound email delivery. Skips gracefully when no provider is configured
 * so queued notifications remain auditable.
 */
import { outboundAllowed } from "@/lib/environment.server";

export type SendOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "suppressed"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "retry"; reason: string; code: string | null; retryAfterSeconds: number | null }
  | { status: "failed"; reason: string; code: string | null };

const SENDER_DOMAIN = process.env["EMAIL_SENDER_DOMAIN"] ?? "";
const FROM_ADDRESS =
  process.env["EMAIL_FROM_ADDRESS"] ??
  (SENDER_DOMAIN ? `Sanadi <no-reply@${SENDER_DOMAIN}>` : "");

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  label?: string;
}): Promise<SendOutcome> {
  void params;
  const outbound = outboundAllowed("email");
  if (!outbound.allowed) return { status: "skipped", reason: "test_environment" };

  // No embedded third-party email gateway. Configure a provider later via env
  // and wire it here; until then deliveries stay skipped (auditable).
  if (!SENDER_DOMAIN || !FROM_ADDRESS) {
    return { status: "skipped", reason: "missing_sender_domain" };
  }
  return { status: "skipped", reason: "email_provider_not_configured" };
}
