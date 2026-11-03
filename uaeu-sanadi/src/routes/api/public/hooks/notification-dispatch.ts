import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Cron entry point that sends queued Sanadi emails. Authenticated with a server-only cron secret. */
export const Route = createFileRoute("/api/public/hooks/notification-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { dispatchQueuedEmails } = await import("@/lib/notifications/dispatch.server");
        const result = await dispatchQueuedEmails();
        return Response.json({ success: true, result });
      },
    },
  },
});
