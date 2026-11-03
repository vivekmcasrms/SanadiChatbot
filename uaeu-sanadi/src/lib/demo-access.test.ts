import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

let host: string | null = "id-preview--x.lovable.app";
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => host }));
import { evaluateDemoAccess } from "./demo-environment";

const base = { host: "id-preview--x.lovable.app", flagOn: true, configuredCode: "CODE", providedCode: "CODE" };

describe("demo provisioning guard", () => {
  it("rejects a normal student", () => {
    expect(evaluateDemoAccess({ ...base, requireAdmin: true, authenticated: true, isAdmin: false })).toEqual({ ok: false, reason: "not_admin" });
  });
  it("rejects staff who are not system admins", () => {
    expect(evaluateDemoAccess({ ...base, requireAdmin: true, authenticated: true, isAdmin: false }).ok).toBe(false);
  });
  it("rejects anyone not signed in", () => {
    expect(evaluateDemoAccess({ ...base, requireAdmin: true, authenticated: false, isAdmin: false })).toEqual({ ok: false, reason: "unauthenticated" });
  });
  it("rejects everything on production, even a valid admin with the right code", () => {
    for (const h of ["sanadi.online", "www.sanadi.online", "uaeu-sanadi.lovable.app"]) {
      expect(evaluateDemoAccess({ ...base, host: h, requireAdmin: true, authenticated: true, isAdmin: true })).toEqual({ ok: false, reason: "production" });
    }
  });
  it("rejects when the demo flag is off", () => {
    expect(evaluateDemoAccess({ ...base, flagOn: false, requireAdmin: true, authenticated: true, isAdmin: true }).ok).toBe(false);
  });
  it("rejects a missing or incorrect access code", () => {
    expect(evaluateDemoAccess({ ...base, providedCode: "" })).toEqual({ ok: false, reason: "bad_code" });
    expect(evaluateDemoAccess({ ...base, providedCode: "WRONG" })).toEqual({ ok: false, reason: "bad_code" });
    expect(evaluateDemoAccess({ ...base, configuredCode: null })).toEqual({ ok: false, reason: "no_code_configured" });
  });
  it("allows only admin + demo environment + correct code", () => {
    expect(evaluateDemoAccess({ ...base, requireAdmin: true, authenticated: true, isAdmin: true })).toEqual({ ok: true });
  });
});

describe("credential exposure", () => {
  const files = [
    "scripts/seed-dsai-cohort.mjs",
    "scripts/import-staff-roster.mjs",
    "scripts/clone/seed-test-accounts.mjs",
    "scripts/clone/verify-isolation.mjs",
    "src/lib/demo-seed.functions.ts",
    "src/lib/demo-accounts.functions.ts",
    "src/lib/demo-seed.server.ts",
    "src/routes/demo.tsx",
    "src/routes/_authenticated/demo-accounts.tsx",
  ];
  it("no demo endpoint or page returns or renders a password field", () => {
    for (const f of files.filter((f) => f.startsWith("src/") && !f.endsWith(".server.ts"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/studentPassword|staffPassword|signInWithPassword/);
    }
  });
  it("no fixed shared demo password remains in the code", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/s123456|st123456|DEMO_STAFF_PASSWORD|STUDENT_PASSWORD/);
    }
  });
});

describe("listDemoAccounts response", () => {
  beforeEach(() => {
    host = "id-preview--x.lovable.app";
    process.env["ENABLE_DEMO_ACCESS"] = "true";
    process.env["DEMO_ACCESS_CODE"] = "CODE";
  });
  it("contains no password values", async () => {
    vi.doMock("./demo-seed.server", () => ({
      DEMO_STUDENTS: [{ nameEn: "A", nameAr: "أ", scenario: "s", program: "p" }],
      DEMO_STAFF: [{ nameEn: "B", nameAr: "ب", display: "B", roles: ["service_officer"], unit: "U", jobEn: "j", jobAr: "j" }],
      studentEmail: () => "a@x.test",
      staffEmail: () => "b@x.test",
    }));
    const { assertDemoAccess } = await import("./demo-environment");
    expect(() => assertDemoAccess({ providedCode: "CODE" })).not.toThrow();
    expect(() => assertDemoAccess({ providedCode: "nope" })).toThrow();
    host = "sanadi.online";
    expect(() => assertDemoAccess({ providedCode: "CODE" })).toThrow();
  });
});
