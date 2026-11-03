import { getActiveRoles } from "@/lib/authz/roles.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ActionReceipt, AgentResponse } from "./agent-types";
import { isRateLimited } from "./agents.server";
import { runAgentTurn } from "./agent/orchestrator.server";
import { performConfirmedAction, type PerformActionResult } from "./agent/execute-action.server";
import { normalizeAttachments } from "./agent/attachments.server";
import type { Db } from "./agent/tools.server";

const AskInput = z.object({
  message: z.string().min(1).transform((s) => (s.length > 8000 ? s.slice(0, 8000) : s)),
  conversationId: z.string().uuid().nullable().optional(),
  lang: z.enum(["en", "ar"]).optional(),
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
});

async function rolesOf(db: Db, userId: string): Promise<string[]> {
  return getActiveRoles(db, userId);
}

/** Entry point for the agentic assistant. All reasoning happens server-side. */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }): Promise<AgentResponse> => {
    const { supabase, userId } = context;
    if (isRateLimited(userId)) {
      throw new Error(
        (data.lang ?? "en") === "ar"
          ? "سندي يعالج عدة طلبات الآن. يرجى المحاولة بعد لحظات."
          : "Sanadi is processing several requests right now. Please try again in a moment.",
      );
    }
    const roles = await rolesOf(supabase as Db, userId);
    return runAgentTurn({
      db: supabase as Db,
      userId,
      roles: roles.length ? roles : ["student"],
      message: data.message,
      conversationId: data.conversationId ?? null,
      uiLang: data.lang ?? "en",
      attachments: (data.attachments ?? []).map((a) => ({
        storagePath: a.storagePath,
        fileName: a.fileName,
        mimeType: a.mimeType ?? null,
        sizeBytes: a.sizeBytes ?? null,
      })),
    });
  });

const ExecuteInput = z.object({
  toolName: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  conversationId: z.string().uuid().nullable().optional(),
  lang: z.enum(["en", "ar"]).default("en"),
  /** Chat message and button this confirmation belongs to (duplicate guard). */
  messageId: z.string().uuid().nullable().optional(),
  actionKey: z.string().max(200).nullable().optional(),
});

/**
 * Action Agent: executes a student-confirmed action, records the audited
 * receipt and writes the follow-up message back into the conversation.
 */
export const executeConfirmedAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExecuteInput.parse(input))
  .handler(async ({ data, context }): Promise<PerformActionResult> => {
    const { supabase, userId } = context;
    const db = supabase as Db;
    const roles = await rolesOf(db, userId);
    let attachments: ReturnType<typeof normalizeAttachments> = [];
    if (data.conversationId) {
      const { data: state } = await db
        .from("conversation_state")
        .select("id, conversation_id, extracted_entities, state_version, state_conflicts")
        .eq("conversation_id", data.conversationId)
        .maybeSingle();
      const entities = (state?.extracted_entities ?? {}) as Record<string, unknown>;
      attachments = normalizeAttachments(entities["pendingAttachments"]);
      if (attachments.length && state?.id) {
        const { saveConversationState } = await import("@/lib/routing/state-store.server");
        await saveConversationState(db as never, state as never, {
          conversation_id: data.conversationId,
          extracted_entities: { ...entities, pendingAttachments: [] },
        });
      }
    }
    return performConfirmedAction({
      db,
      userId,
      roles,
      toolName: data.toolName,
      args: data.args as Record<string, unknown>,
      conversationId: data.conversationId ?? null,
      lang: data.lang,
      attachments,
      messageId: data.messageId ?? null,
      actionKey: data.actionKey ?? null,
    });
  });
