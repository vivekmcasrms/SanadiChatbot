/**
 * True end-to-end streaming endpoint for the Sanadi assistant.
 *
 * A server function cannot return a stream across the RPC boundary, so the
 * streaming chat path is a raw server route. It authenticates the caller with
 * the same bearer token the server functions use, runs the normal agent turn,
 * and forwards real model tokens as they are produced. The final event carries
 * the complete structured AgentResponse so the UI keeps proposals, receipts and
 * every other field it already renders.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { runAgentTurn } from "@/lib/agent/orchestrator.server";
import { isRateLimited } from "@/lib/agents.server";
import type { Db } from "@/lib/agent/tools.server";

const Body = z.object({
  message: z.string().min(1).transform((s) => (s.length > 8000 ? s.slice(0, 8000) : s)),
  conversationId: z.string().uuid().nullable().optional(),
  lang: z.enum(["en", "ar"]).default("en"),
  attachments: z
    .array(
      z.object({
        storagePath: z.string().min(1).max(500),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().max(200).nullable().optional(),
        sizeBytes: z.number().nullable().optional(),
      }),
    )
    .max(5)
    .optional(),
  /**
   * Benchmarking only, and ignored unless the caller is an administrator:
   * pins the model engine for this one turn so two engines can be compared
   * on identical questions, tools and retrieval.
   */
  benchmarkProvider: z.string().min(1).max(40).optional(),
  benchmarkModel: z.string().min(1).max(120).optional(),
});

const VisibilityBody = z.object({
  traceId: z.string().min(8).max(100),
  firstVisibleMs: z.number().int().min(0).max(300_000),
  streamChunkCount: z.number().int().min(0).max(100_000).optional(),
  streamDurationMs: z.number().int().min(0).max(600_000).optional(),
  finalizationMs: z.number().int().min(0).max(600_000).optional(),
});


// Required only by the compatibility SDK; stripped from outgoing requests.
const SDK_PLACEHOLDER_KEY = "sanadi-sdk-placeholder";

async function authenticate(request: Request) {
  const url = (
    process.env["VITE_API_BASE_URL"] ||
    import.meta.env["VITE_API_BASE_URL"]
  ).replace(/\/$/, "");
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (token.split(".").length !== 3) return null;

  const supabase = createClient<Database>(url, SDK_PLACEHOLDER_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${SDK_PLACEHOLDER_KEY}`) {
          headers.delete("Authorization");
        }
        headers.delete("apikey");
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { id?: string };
  if (!user?.id) return null;
  return { supabase, userId: user.id };
}

export const Route = createFileRoute("/api/chat/stream")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        let payload: z.infer<typeof VisibilityBody>;
        try {
          payload = VisibilityBody.parse(await request.json());
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("response_performance_logs")
          .update({
            first_visible_ms: payload.firstVisibleMs,
            stream_chunk_count: payload.streamChunkCount ?? null,
            stream_duration_ms: payload.streamDurationMs ?? null,
            finalization_ms: payload.finalizationMs ?? null,
          })

          .eq("trace_id", payload.traceId)
          .eq("conversation_id", await ownedConversationId(auth.supabase as Db, auth.userId, payload.traceId));
        return new Response(error ? "Telemetry update failed" : null, { status: error ? 500 : 204 });
      },
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });

        let payload: z.infer<typeof Body>;
        try {
          payload = Body.parse(await request.json());
        } catch {
          return new Response("Invalid request", { status: 400 });
        }

        if (isRateLimited(auth.userId)) {
          return new Response("Too many requests", { status: 429 });
        }

        const db = auth.supabase as Db;
        const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", auth.userId);
        const roles = (roleRows ?? []).map((r) => r.role as string);

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: unknown) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                /* client disconnected */
              }
            };
            try {
              const result = await runAgentTurn({
                db,
                userId: auth.userId,
                roles: roles.length ? roles : ["student"],
                message: payload.message,
                conversationId: payload.conversationId ?? null,
                uiLang: payload.lang,
                attachments: (payload.attachments ?? []).map((a) => ({
                  storagePath: a.storagePath,
                  fileName: a.fileName,
                  mimeType: a.mimeType ?? null,
                  sizeBytes: a.sizeBytes ?? null,
                })),
                providerOverride:
                  payload.benchmarkProvider && payload.benchmarkModel && roles.includes("system_admin")
                    ? { provider: payload.benchmarkProvider, model: payload.benchmarkModel }
                    : null,
                onEvent: send,
              });
              send({ type: "final", response: result });
            } catch (error) {
              // Never surface a provider, stack or database message to a
              // student: record it against the turn's trace reference and
              // answer with the catalogue's plain-language text.
              const { logException } = await import("@/lib/exceptions/handle.server");
              const { exceptionMessage } = await import("@/lib/exceptions/catalogue");
              await logException("api_failure", {
                userId: auth.userId,
                traceId: null,
                conversationId: payload.conversationId ?? null,
                detail: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
                recovered: false,
                recoveryAction: "student_asked_to_retry",
              });
              send({
                type: "error",
                message: exceptionMessage("api_failure", payload.lang === "ar" ? "ar" : "en"),
              });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});

async function ownedConversationId(db: Db, userId: string, traceId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: perf } = await supabaseAdmin
    .from("response_performance_logs")
    .select("conversation_id")
    .eq("trace_id", traceId)
    .maybeSingle();
  if (!perf?.conversation_id) return "00000000-0000-0000-0000-000000000000";
  const { data } = await db
    .from("conversations")
    .select("id")
    .eq("id", perf.conversation_id)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id ?? "00000000-0000-0000-0000-000000000000";
}
