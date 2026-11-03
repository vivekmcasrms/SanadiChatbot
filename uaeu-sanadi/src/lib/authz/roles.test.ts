import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { authorize, effectiveRoles } from "./roles";

const ADMIN = ["system_admin"];
const STAFF_CASES = ["service_officer", "service_manager", "system_admin"];

describe("authorization rule", () => {
  it("active student cannot use staff or admin functions", () => {
    const s = { roles: ["student"] };
    expect(authorize(s, STAFF_CASES)).toEqual({ ok: false, reason: "role" });
    expect(authorize(s, ADMIN).ok).toBe(false);
  });
  it("active staff can work cases in their own unit", () => {
    expect(authorize({ roles: ["service_officer"] }, STAFF_CASES, { unitIds: ["u1"], targetUnitId: "u1" }).ok).toBe(true);
  });
  it("active admin may use admin functions in any unit", () => {
    expect(authorize({ roles: ["system_admin"] }, ADMIN, { unitIds: [], targetUnitId: "u9" }).ok).toBe(true);
  });
  it("revoked staff is denied", () => {
    expect(authorize({ roles: ["service_officer"], revoked: true }, STAFF_CASES)).toEqual({ ok: false, reason: "revoked" });
  });
  it("revoked admin is denied and keeps no admin role", () => {
    const s = { roles: ["system_admin", "student"], revoked: true };
    expect(authorize(s, ADMIN)).toEqual({ ok: false, reason: "revoked" });
    expect(effectiveRoles(s)).toEqual(["student"]);
  });
  it("disabled or deleted account is denied", () => {
    expect(authorize({ roles: ["service_manager"], disabled: true }, STAFF_CASES).ok).toBe(false);
  });
  it("wrong-unit staff is denied", () => {
    expect(authorize({ roles: ["service_officer"] }, STAFF_CASES, { unitIds: ["u1"], targetUnitId: "u2" })).toEqual({ ok: false, reason: "unit" });
  });
  it("role removed during an active session is denied on the next check", () => {
    const before = { roles: ["service_officer"] };
    expect(authorize(before, STAFF_CASES).ok).toBe(true);
    const after = { roles: [] as string[] }; // roles are re-read on every privileged call
    expect(authorize(after, STAFF_CASES)).toEqual({ ok: false, reason: "role" });
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("single authorization path", () => {
  // Files allowed to touch the role table: the central helper, role management,
  // demo seeding (writes), notification fan-out and display labelling.
  const ALLOWED = [
    "authz/roles.server.ts",
    "admin/access.functions.ts",
    "routes/_authenticated/admin.tsx",
    "demo-seed.server.ts",
    "notifications/queue.server.ts",
    "notifications/admin.server.ts",
    "ops/case-dossier.server.ts",
    "ops/assignment.server.ts",
    "integrations/supabase/types.ts",
  ];
  it("no other code reads user_roles directly", () => {
    const offenders = files("src").filter(
      (f) => !ALLOWED.some((a) => f.replace(/\\/g, "/").endsWith(a)) && /from\("user_roles"\)/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
