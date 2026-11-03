/**
 * Single switch for every demo capability (demo sign-in page, demo account
 * directory, demo seeding). Server-only: call inside handlers.
 *
 * Demo tools are on only when ENABLE_DEMO_ACCESS is "true" AND the request is
 * not served from a production address. Preview and production share one
 * configuration, so the production-host check is what keeps demo tools out of
 * the live site even when the flag is set for preview testing.
 */
import { getRequestHost } from "@tanstack/react-start/server";

const PRODUCTION_HOSTS = ["sanadi.online", "www.sanadi.online", "uaeu-sanadi.lovable.app"];

export function isProductionHost(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().split(":")[0]?.trim() ?? "";
  return PRODUCTION_HOSTS.includes(h);
}

function currentHost(): string | null {
  try {
    return getRequestHost({ xForwardedHost: true }) ?? null;
  } catch {
    return null;
  }
}

export function demoFlagOn(): boolean {
  return (process.env["ENABLE_DEMO_ACCESS"] ?? "").trim().toLowerCase() === "true";
}

export function demoEnvironmentEnabled(host: string | null = currentHost()): boolean {
  // Unknown host fails closed.
  if (!host || isProductionHost(host)) return false;
  return demoFlagOn();
}

export function demoAccessCode(): string | null {
  return (process.env["DEMO_ACCESS_CODE"] ?? "").trim() || null;
}

export type DemoAccessInput = {
  host: string | null;
  flagOn: boolean;
  configuredCode: string | null;
  providedCode: string | null | undefined;
  /** Set when the action needs a signed-in system administrator. */
  requireAdmin?: boolean;
  authenticated?: boolean;
  isAdmin?: boolean;
};

export type DemoAccessDecision = { ok: true } | { ok: false; reason: "production" | "disabled" | "no_code_configured" | "bad_code" | "unauthenticated" | "not_admin" };

/** Pure decision used by every demo server function. Fails closed. */
export function evaluateDemoAccess(i: DemoAccessInput): DemoAccessDecision {
  if (!i.host || isProductionHost(i.host)) return { ok: false, reason: "production" };
  if (!i.flagOn) return { ok: false, reason: "disabled" };
  if (i.requireAdmin) {
    if (!i.authenticated) return { ok: false, reason: "unauthenticated" };
    if (!i.isAdmin) return { ok: false, reason: "not_admin" };
  }
  if (!i.configuredCode) return { ok: false, reason: "no_code_configured" };
  if ((i.providedCode ?? "").trim() !== i.configuredCode) return { ok: false, reason: "bad_code" };
  return { ok: true };
}

/** Throws a generic error unless demo access is allowed for this request. */
export function assertDemoAccess(i: Omit<DemoAccessInput, "host" | "flagOn" | "configuredCode">): void {
  const d = evaluateDemoAccess({ ...i, host: currentHost(), flagOn: demoFlagOn(), configuredCode: demoAccessCode() });
  if (!d.ok) throw new Error(d.reason === "bad_code" ? "Invalid demo access code" : "Demo tools are unavailable");
}
