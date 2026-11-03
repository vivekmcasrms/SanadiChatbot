import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Cron entry point for the operations jobs. Authenticated with a server-only cron secret. */
export const Route = createFileRoute("/api/public/hooks/run-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        let job = "all";
        try {
          const body = (await request.json()) as { job?: string };
          if (body?.job) job = body.job;
        } catch {
          // empty body → run everything
        }

        const { runScheduledJob } = await import("@/lib/ops/jobs.server");
        const result = await runScheduledJob(job as never);
        return Response.json({ success: true, result });
      },
    },
  },
});
