/** Proactive alerts and suggestion themes. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Refreshes the signed-in student's proactive alerts from live records. */
export const refreshMyProactiveAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { generateProactiveAlerts, reconcileProactiveAlerts } = await import("./ops/proactive.server");
    const [created, closed] = await Promise.all([
      generateProactiveAlerts(context.supabase, context.userId),
      reconcileProactiveAlerts(context.supabase, context.userId),
    ]);
    return { created: created.created, types: created.types, closed };
  });

/** Groups open suggestions into themes for the Service Owner. */
export const getSuggestionThemes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertStaff } = await import("./ops/case-actions.server");
    await assertStaff(context.userId);
    const { buildSuggestionThemes } = await import("./ops/suggestion-clusters.server");
    return buildSuggestionThemes(context.supabase);
  });