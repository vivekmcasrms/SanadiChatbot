import { auditInsert } from "@/lib/exceptions/handle.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertDemoAccess, demoAccessCode, demoEnvironmentEnabled } from "./demo-environment";

/**
 * Demo capabilities are environment-gated on the server: never on production
 * addresses, only with the demo flag on, and always behind a configured access
 * code. Passwords are never returned; persona sign-in uses one-time tokens.
 */
export const getDemoAccessState = createServerFn({ method: "GET" }).handler(async () => {
  const enabled = demoEnvironmentEnabled() && Boolean(demoAccessCode());
  return { enabled, requiresCode: true };
});

const codeSchema = z.object({ accessCode: z.string().max(200).nullable().optional() });

/** Builds the fictional demo environment. System admin + demo environment + access code. */
export const provisionDemoEnvironment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => codeSchema.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    assertDemoAccess({ requireAdmin: true, authenticated: true, isAdmin: Boolean(isAdmin), providedCode: data.accessCode });

    const { seedDemoEnvironment } = await import("./demo-seed.server");
    const result = await seedDemoEnvironment();
    await auditInsert(supabase, { actor_id: userId, action: "demo.environment_seeded", entity_type: "system", metadata: result });
    return result;
  });

/** Names of the fictional personas. Never includes credentials. */
export const listDemoAccounts = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => codeSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    assertDemoAccess({ providedCode: data.accessCode });
    const { DEMO_STUDENTS, DEMO_STAFF, studentEmail, staffEmail } = await import("./demo-seed.server");
    return {
      students: DEMO_STUDENTS.map((s) => ({ email: studentEmail(s), nameEn: s.nameEn, nameAr: s.nameAr, scenario: s.scenario, program: s.program })),
      staff: DEMO_STAFF.map((s) => ({
        email: staffEmail(s), nameEn: s.nameEn, nameAr: s.nameAr, display: s.display, role: s.roles[0] ?? "service_officer",
        unit: s.unit, jobEn: s.jobEn, jobAr: s.jobAr, isOwner: !!s.owner, scenario: s.scenario ?? null,
      })),
    };
  });

/** One-time sign-in token for a demo persona (public demo page, access code required). */
export const demoPersonaSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => codeSchema.extend({ email: z.string().email().max(200) }).parse(input))
  .handler(async ({ data }) => {
    assertDemoAccess({ providedCode: data.accessCode });
    const { mintDemoSignInToken } = await import("./demo-seed.server");
    return { tokenHash: await mintDemoSignInToken(data.email) };
  });
