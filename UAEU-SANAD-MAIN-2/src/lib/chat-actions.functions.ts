import { apiFetch } from "@/lib/auth-token";

export type CompletedChatAction = {
  messageId: string | null;
  actionKey: string;
  actionType: string;
  referenceNumber: string | null;
  submittedAt: string;
};

/**
 * One-time actions the student already completed in this conversation, so a
 * reopened chat renders those buttons as done instead of clickable.
 */
export async function listCompletedChatActionsFn(
  opts: { data: { conversationId: string | null } },
): Promise<CompletedChatAction[]> {
  if (!opts.data.conversationId) return [];
  return apiFetch<CompletedChatAction[]>(`/api/chats/${opts.data.conversationId}/completed-actions`);
}

