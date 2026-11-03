import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DemoAccountStatus = {
  email: string;
  nameEn: string;
  nameAr: string;
  kind: "student" | "staff";
  role: string;
  unit: string | null;
  jobEn: string | null;
  jobAr: string | null;
  isOwner: boolean;
  scenario: string | null;
  provisioned: boolean;
  lastSignInAt: string | null;
};

/**
 * Administrative view of the fictional demo personas: which accounts exist,
 * who owns which service unit, and when each persona last signed in.
 * System administrators only.
 */
export const getDemoAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { demoEnvironmentEnabled } = await import("./demo-environment");
    if (!demoEnvironmentEnabled()) throw new Error("Demo tools are unavailable in this environment.");
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only a system administrator can view demo accounts.");

    const [{ DEMO_STUDENTS, DEMO_STAFF, studentEmail, staffEmail }, { supabaseAdmin }] =
      await Promise.all([import("./demo-seed.server"), import("@/integrations/supabase/client.server")]);

    const byEmail = new Map<string, { last_sign_in_at: string | null }>();
    for (let page = 1; page <= 10; page++) {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      for (const u of data?.users ?? []) {
        if (u.email) byEmail.set(u.email.toLowerCase(), { last_sign_in_at: u.last_sign_in_at ?? null });
      }
      if (!data || data.users.length < 200) break;
    }

    const accounts: DemoAccountStatus[] = [
      ...DEMO_STAFF.map((s) => {
        const found = byEmail.get(staffEmail(s).toLowerCase());
        return {
          email: staffEmail(s),
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          kind: "staff" as const,
          role: s.roles[0] ?? "service_officer",
          unit: s.unit,
          jobEn: s.jobEn,
          jobAr: s.jobAr,
          isOwner: !!s.owner,
          scenario: s.scenario ?? null,
          provisioned: !!found,
          lastSignInAt: found?.last_sign_in_at ?? null,
        };
      }),
      ...DEMO_STUDENTS.map((s) => {
        const found = byEmail.get(studentEmail(s).toLowerCase());
        return {
          email: studentEmail(s),
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          kind: "student" as const,
          role: "student",
          unit: null,
          jobEn: s.program,
          jobAr: s.program,
          isOwner: false,
          scenario: s.scenario,
          provisioned: !!found,
          lastSignInAt: found?.last_sign_in_at ?? null,
        };
      }),
    ];

    return { accounts };
  });

/** Admin "open persona": one-time sign-in token, never a password. */
export const openDemoPersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ email: z.string().email().max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const { demoEnvironmentEnabled } = await import("./demo-environment");
    if (!demoEnvironmentEnabled()) throw new Error("Demo tools are unavailable in this environment.");
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only a system administrator can open demo personas.");
    const { mintDemoSignInToken } = await import("./demo-seed.server");
    return { tokenHash: await mintDemoSignInToken(data.email) };
  });
