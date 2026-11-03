import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Cron entry point that builds the daily service-owner digest. Authenticated with a server-only cron secret. */
export const Route = createFileRoute("/api/public/hooks/notification-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { runOwnerDigest } = await import("@/lib/notifications/digest.server");
        const result = await runOwnerDigest();
        return Response.json({ success: true, result });
      },
    },
  },
});
