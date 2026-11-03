import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type CompletedChatAction = {
  messageId: string | null;
  actionKey: string;
  actionType: string;
  referenceNumber: string | null;
  submittedAt: string;
};

const Input = z.object({ conversationId: z.string().uuid().nullable() });

/**
 * One-time actions the student already completed in this conversation, so a
 * reopened chat renders those buttons as done instead of clickable.
 */
export const listCompletedChatActionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CompletedChatAction[]> => {
    if (!data.conversationId) return [];
    const { data: rows } = await context.supabase
      .from("chat_action_completions")
      .select("message_id, action_key, action_type, reference_number, submitted_at")
      .eq("student_id", context.userId)
      .eq("conversation_id", data.conversationId)
      .order("submitted_at", { ascending: true });
    return (rows ?? []).map((r) => ({
      messageId: r.message_id,
      actionKey: r.action_key,
      actionType: r.action_type,
      referenceNumber: r.reference_number,
      submittedAt: r.submitted_at,
    }));
  });
