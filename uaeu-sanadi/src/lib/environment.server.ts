/**
 * Sanadi environment identity for server code, plus the single outbound guard.
 *
 * Production keeps `SANADI_ENV` unset, so `serverEnv()` returns PRODUCTION and
 * every guard below is a no-op. In the duplicated project `SANADI_ENV=TEST`
 * blocks real email and any write to live university/external systems.
 */
import { normaliseSanadiEnv, type SanadiEnv } from "./environment";

export function serverEnv(): SanadiEnv {
  return normaliseSanadiEnv(process.env["SANADI_ENV"]);
}

export function isTestServerEnvironment(): boolean {
  return serverEnv() === "TEST";
}

/**
 * Outbound side effects that must never leave a test environment:
 * email delivery, writes to university systems, writes to partner APIs.
 * Read-only lookups (library catalogue search, AI inference) are allowed and
 * are listed explicitly in docs/TEST_ENVIRONMENT.md.
 */
export type OutboundChannel =
  | "email"
  | "sms"
  | "university_system_write"
  | "external_api_write";

export type OutboundDecision =
  | { allowed: true }
  | { allowed: false; reason: "test_environment"; channel: OutboundChannel };

export function outboundAllowed(channel: OutboundChannel): OutboundDecision {
  if (isTestServerEnvironment()) return { allowed: false, reason: "test_environment", channel };
  return { allowed: true };
}

/** Throwing variant for code paths that must abort rather than degrade. */
export function assertOutboundAllowed(channel: OutboundChannel): void {
  const decision = outboundAllowed(channel);
  if (!decision.allowed) {
    throw new Error(`Blocked ${channel}: Sanadi is running in the TEST environment (SANADI_ENV=TEST).`);
  }
}
